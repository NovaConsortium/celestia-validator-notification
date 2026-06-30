/**
 * Worker boot: load env, init Prisma, Celenium block stream(s), SkipTracker,
 * subscription refresher, channel dispatcher. Graceful shutdown on
 * SIGTERM/SIGINT.
 *
 * Detection model (Celestia / CometBFT):
 * - Celenium WS `blocks` channel announces each new height (trigger only — the
 *   payload has no signature set).
 * - For height H we read the CANONICAL commit at H - COMMIT_LAG (a block's
 *   commit is finalized inside the next block, so the just-announced head is
 *   provisional; lagging a couple blocks gives a stable signer set).
 * - `fetchSigners` → consensus addresses that signed; `fetchActiveSet` → bonded
 *   set. A watched validator that is in the active set but not in the signers
 *   set missed that height → fed to SkipTracker as a "timeout". Signed → success.
 * - Validators that left the active set (jailed/unbonded) are skipped, so we
 *   never raise a false offline for an intentionally-exited validator.
 *
 * The worker is the only writer of Event rows; the dispatcher consumes them.
 */
import { prisma, withDbRetry } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { startBlockConsumer, type BlockEvent } from "./celestia/ws";
import { fetchSigners, fetchActiveSet } from "./celestia/commit";
import { fetchStakingMessages, type StakingMessage } from "./celestia/staking";
import { SkipTracker, type ThresholdConfig } from "./tracker/skip";
import type { Network, ValidatorEvent } from "@/types/events";
import {
  installProcessGuards,
  reportEvent,
  reportStatus,
  describeError,
} from "@/lib/monitoring";

interface WsHandle {
  stop(): void;
}

interface WatchedValidator {
  id: bigint;
  cons: string; // uppercase hex consensus address
  valoper?: string; // bech32 celestiavaloper1… (lowercase), for staking matches
  wantDelegation: boolean;
  wantCommission: boolean;
  /** Loosest delegation threshold (utia) across subs that want delegation. */
  delegationMinUtia: bigint;
}

const consumers = new Map<Network, WsHandle>();
let watchedByNetwork = new Map<Network, WatchedValidator[]>();
const thresholdCache = new Map<string, Partial<ThresholdConfig>>();
// Last-known commission rate per validator, so a MsgEditValidator can render
// old → new. Seeded lazily; the first change after boot shows a blank old.
const commissionCache = new Map<string, string>();
const lastProcessed = new Map<Network, number>(); // last height fully processed
const processing = new Set<Network>(); // re-entrancy guard per network
let subRefreshInterval: NodeJS.Timeout | null = null;
let dispatchInterval: NodeJS.Timeout | null = null;

// A block's commit is finalized in the following block; lag to read a stable
// signer set. ~2 blocks ≈ 12s extra detection latency — fine for offline alerts.
const COMMIT_LAG = Number(process.env.CELESTIA_COMMIT_LAG ?? 2);
// On cold start / after a gap, never replay more than this many heights — we
// don't want to fire alerts for long-past misses after the worker was down.
const MAX_CATCHUP = Number(process.env.CELESTIA_MAX_CATCHUP ?? 50);

function watchKey(id: bigint, network: Network): string {
  return `${id.toString()}:${network}`;
}

async function getThresholds(
  validatorId: bigint,
  network: Network,
): Promise<Partial<ThresholdConfig> | null> {
  return thresholdCache.get(watchKey(validatorId, network)) ?? null;
}

/** Rebuild watched set + threshold cache + consensus-address map in one pass. */
async function refreshWatched(): Promise<Set<Network>> {
  const subs = await withDbRetry(() =>
    prisma.subscription.findMany({
      select: { validatorId: true, network: true, alertConfig: true },
    }),
  );
  const networksWithWatchers = new Set<Network>();
  const nextCache = new Map<string, { perSkip: boolean; minOffline: number }>();
  const stakingAgg = new Map<
    string,
    { delegation: boolean; commission: boolean; minUtia: bigint }
  >();
  const seen = new Set<string>();
  const idsByNetwork = new Map<Network, Set<bigint>>();

  for (const s of subs) {
    if (s.network !== "mainnet" && s.network !== "testnet") continue;
    const net = s.network as Network;
    const key = watchKey(s.validatorId, net);
    networksWithWatchers.add(net);
    if (!seen.has(key)) {
      seen.add(key);
      const set = idsByNetwork.get(net) ?? new Set<bigint>();
      set.add(s.validatorId);
      idsByNetwork.set(net, set);
    }
    const cfg = (s.alertConfig as Record<string, unknown>) ?? {};
    const cur = nextCache.get(key) ?? { perSkip: false, minOffline: Number.POSITIVE_INFINITY };
    if (cfg.slotSkip === true) cur.perSkip = true;
    const offlineEnabled = cfg.offline !== false;
    if (offlineEnabled) {
      const n = typeof cfg.offlineAfterN === "number" ? cfg.offlineAfterN : null;
      if (n !== null && n > 0 && n < cur.minOffline) cur.minOffline = n;
    }
    nextCache.set(key, cur);

    // Staking opt-ins (explicit `=== true`, like slotSkip). Track the loosest
    // delegation threshold so the worker emits whenever any sub could want it;
    // the dispatcher enforces each sub's own threshold precisely.
    const stake = stakingAgg.get(key) ?? {
      delegation: false,
      commission: false,
      minUtia: -1n,
    };
    if (cfg.commission === true) stake.commission = true;
    if (cfg.delegation === true) {
      stake.delegation = true;
      const tia = typeof cfg.delegationMinTia === "number" ? cfg.delegationMinTia : 0;
      const utia = BigInt(Math.max(0, Math.floor(tia * 1_000_000)));
      stake.minUtia = stake.minUtia < 0n ? utia : (utia < stake.minUtia ? utia : stake.minUtia);
    }
    stakingAgg.set(key, stake);
  }

  // Resolve consensus address for each watched validator. Backfill from
  // Celenium for rows missing it so older subscriptions self-heal.
  const nextWatched = new Map<Network, WatchedValidator[]>();
  for (const [net, ids] of idsByNetwork) {
    const rows = await withDbRetry(() =>
      prisma.validator.findMany({
        where: { network: net, id: { in: Array.from(ids) } },
        select: { id: true, consAddress: true, valoper: true },
      }),
    );
    const consById = new Map<string, string | null>();
    const valoperById = new Map<string, string | null>();
    for (const r of rows) {
      consById.set(r.id.toString(), r.consAddress ?? null);
      valoperById.set(r.id.toString(), r.valoper ?? null);
    }

    // Backfill missing consAddress / valoper from Celenium so older
    // subscriptions self-heal (consAddress drives miss detection; valoper
    // drives staking matches).
    const missing = Array.from(ids).filter(
      (id) => !consById.get(id.toString()) || !valoperById.get(id.toString()),
    );
    if (missing.length > 0) {
      try {
        const { fetchValidators } = await import("@/lib/celenium");
        const meta = await fetchValidators(net);
        const metaById = new Map(meta.map((m) => [m.id, m]));
        for (const id of missing) {
          const m = metaById.get(id.toString());
          if (!m) continue;
          await withDbRetry(() =>
            prisma.validator.update({
              where: { id_network: { id, network: net } },
              data: { consAddress: m.consAddress, valoper: m.valoper ?? null },
            }),
          ).catch(() => {});
          consById.set(id.toString(), m.consAddress);
          if (m.valoper) valoperById.set(id.toString(), m.valoper);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[worker] celenium meta backfill failed for ${net}`, err);
      }
    }

    const list: WatchedValidator[] = [];
    for (const id of ids) {
      const cons = consById.get(id.toString());
      if (!cons) continue;
      const stake = stakingAgg.get(watchKey(id, net));
      list.push({
        id,
        cons: cons.toUpperCase(),
        valoper: valoperById.get(id.toString())?.toLowerCase() ?? undefined,
        wantDelegation: stake?.delegation ?? false,
        wantCommission: stake?.commission ?? false,
        delegationMinUtia: stake && stake.minUtia >= 0n ? stake.minUtia : 0n,
      });
    }
    nextWatched.set(net, list);
  }

  thresholdCache.clear();
  for (const [key, v] of nextCache) {
    thresholdCache.set(key, {
      perSkipAlerts: v.perSkip,
      offlineAfterN: Number.isFinite(v.minOffline) ? v.minOffline : undefined,
    });
  }
  watchedByNetwork = nextWatched;
  return networksWithWatchers;
}

/** Reseed offline state from persisted Events so a restart still fires recovered. */
async function hydrateTracker(tracker: SkipTracker): Promise<void> {
  const watchedList: { id: bigint; network: Network }[] = [];
  for (const [net, list] of watchedByNetwork) {
    for (const v of list) watchedList.push({ id: v.id, network: net });
  }
  if (watchedList.length === 0) return;
  let rows: { validatorId: bigint; network: string; type: string; dedupKey: string | null }[];
  try {
    rows = await withDbRetry(() =>
      prisma.event.findMany({
        where: {
          type: { in: ["offline", "recovered"] },
          OR: watchedList.map((k) => ({ validatorId: k.id, network: k.network })),
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        select: { validatorId: true, network: true, type: true, dedupKey: true },
      }),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[worker] tracker hydrate query failed", err);
    return;
  }
  const seen = new Set<string>();
  let seeded = 0;
  for (const row of rows) {
    const key = `${row.validatorId.toString()}:${row.network}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (row.type !== "offline" || !row.dedupKey) continue;
    tracker.seedOffline(row.validatorId, row.network as Network, row.dedupKey);
    seeded += 1;
  }
  if (seeded > 0) {
    // eslint-disable-next-line no-console
    console.log(`[worker] hydrated tracker: ${seeded} validator(s) primed offline`);
  }
}

async function emitEvent(e: ValidatorEvent): Promise<void> {
  try {
    await withDbRetry(() =>
      prisma.event.create({
        data: {
          validatorId: e.validatorId,
          network: e.network,
          type: e.type,
          severity: e.severity,
          payload: e.payload as Prisma.InputJsonValue,
          blockNumber: e.blockNumber ?? null,
          occurredAt: e.occurredAt,
          dedupKey: e.dedupKey ?? null,
        },
      }),
    );
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      e.dedupKey
    ) {
      // eslint-disable-next-line no-console
      console.log(`[worker] dedupKey already exists: ${e.dedupKey}`);
      return;
    }
    // eslint-disable-next-line no-console
    console.error("[worker] failed to write event row", err);
    reportEvent({
      key: "worker:event-write",
      severity: "warning",
      title: "Worker failed to persist event",
      message: `Event ${e.type} for validator ${e.validatorId} on ${e.network} could not be written.`,
      fields: [{ name: "error", value: describeError(err, 400) }],
    });
    throw err;
  }
}

/**
 * Process a single canonical height: fetch the signer + active sets once, then
 * feed each watched validator on this network into the tracker.
 */
async function processHeight(
  height: number,
  network: Network,
  tracker: SkipTracker,
): Promise<void> {
  const watched = watchedByNetwork.get(network);
  if (!watched || watched.length === 0) return;
  const [signers, activeSet] = await Promise.all([
    fetchSigners(height, network),
    fetchActiveSet(height, network),
  ]);
  for (const v of watched) {
    if (!activeSet.has(v.cons)) continue; // not bonded → don't count as a miss
    const status: "success" | "timeout" = signers.has(v.cons) ? "success" : "timeout";
    await tracker
      .onSlot(
        { slot: height, valId: v.id, status, blockNumber: BigInt(height) },
        emitEvent,
        network,
      )
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[worker:${network}] tracker.onSlot threw`, err);
      });
  }

  // Delegation / commission events come from Celenium block messages, not the
  // commit set. Best-effort: a failure here must not pause miss detection, so
  // we log and move on (events dedup by Celenium message id, so a retried
  // height never double-emits).
  await processStaking(height, network, watched).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn(`[worker:${network}] staking scan failed at ${height}`, err);
  });
}

/** Emit delegate/undelegate/commission_changed events for watched validators. */
async function processStaking(
  height: number,
  network: Network,
  watched: WatchedValidator[],
): Promise<void> {
  const wantDelegation = watched.some((v) => v.wantDelegation);
  const wantCommission = watched.some((v) => v.wantCommission);
  if (!wantDelegation && !wantCommission) return;

  const byValoper = new Map<string, WatchedValidator>();
  for (const v of watched) if (v.valoper) byValoper.set(v.valoper, v);
  if (byValoper.size === 0) return;

  const msgs = await fetchStakingMessages(height, network, {
    delegation: wantDelegation,
    commission: wantCommission,
  });

  for (const m of msgs) {
    if (m.type === "MsgEditValidator") {
      const v = m.valoper ? byValoper.get(m.valoper.toLowerCase()) : undefined;
      if (!v || !v.wantCommission || m.commissionRate == null) continue;
      const key = watchKey(v.id, network);
      const oldRate = commissionCache.get(key) ?? "";
      commissionCache.set(key, m.commissionRate);
      if (oldRate === m.commissionRate) continue; // edit didn't change the rate
      await emitStaking(v, network, height, m, "commission_changed", {
        oldCommission: oldRate,
        newCommission: m.commissionRate,
      });
      continue;
    }

    // Delegation family. Redelegate counts as a delegate to the destination
    // and an undelegate from the source.
    const targets: Array<{ valoper?: string; type: "delegate" | "undelegate" }> =
      m.type === "MsgBeginRedelegate"
        ? [
            { valoper: m.dstValoper, type: "delegate" },
            { valoper: m.srcValoper, type: "undelegate" },
          ]
        : [{ valoper: m.valoper, type: m.type === "MsgUndelegate" ? "undelegate" : "delegate" }];

    for (const t of targets) {
      const v = t.valoper ? byValoper.get(t.valoper.toLowerCase()) : undefined;
      if (!v || !v.wantDelegation) continue;
      const amt = m.amountUtia ? BigInt(m.amountUtia) : 0n;
      if (amt < v.delegationMinUtia) continue; // below the loosest threshold
      await emitStaking(v, network, height, m, t.type, {
        delegator: m.delegator ?? "",
        amount: m.amountUtia ?? "",
        validatorAddress: t.valoper ?? "",
        txHash: m.txHash ?? "",
      });
    }
  }
}

async function emitStaking(
  v: WatchedValidator,
  network: Network,
  height: number,
  m: StakingMessage,
  type: "delegate" | "undelegate" | "commission_changed",
  payload: Record<string, unknown>,
): Promise<void> {
  await emitEvent({
    validatorId: v.id,
    network,
    type,
    severity: "info",
    payload,
    blockNumber: BigInt(height),
    occurredAt: m.occurredAt,
    dedupKey: `${type}:${network}:${m.id}`,
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[worker:${network}] emit ${type} failed`, err);
  });
}

function startNetworkConsumer(network: Network, tracker: SkipTracker): void {
  if (consumers.has(network)) return;
  const handle = startBlockConsumer(network, (block: BlockEvent) => {
    void onNewBlock(block, tracker);
  });
  consumers.set(network, handle);
}

async function onNewBlock(block: BlockEvent, tracker: SkipTracker): Promise<void> {
  const { network, height } = block;
  const target = height - COMMIT_LAG;
  if (target < 1) return;
  // Re-entrancy guard: commit/active-set fetches take longer than the ~6s block
  // time under load; skip overlapping runs and let the next block catch up.
  if (processing.has(network)) return;
  processing.add(network);
  try {
    let from = (lastProcessed.get(network) ?? target - 1) + 1;
    if (target - from > MAX_CATCHUP) from = target - MAX_CATCHUP; // cap backlog
    for (let h = from; h <= target; h++) {
      try {
        await processHeight(h, network, tracker);
        lastProcessed.set(network, h);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[worker:${network}] processHeight ${h} failed`, err);
        reportStatus({
          key: `commit:${network}`,
          state: "down",
          severity: "warning",
          title: `Commit fetch failed (${network})`,
          message: `Could not read signer set for height ${h}. Detection paused until RPC recovers.`,
          fields: [{ name: "error", value: describeError(err, 300) }],
        });
        break; // stop the loop; retry from here on the next block
      }
    }
  } finally {
    processing.delete(network);
  }
}

async function bootWorker(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("[worker] starting");

  const networks = await refreshWatched();
  const tracker = new SkipTracker(getThresholds);
  await hydrateTracker(tracker);

  for (const net of networks) startNetworkConsumer(net, tracker);

  subRefreshInterval = setInterval(() => {
    void (async () => {
      try {
        const nets = await refreshWatched();
        for (const net of nets) {
          if (!consumers.has(net)) startNetworkConsumer(net, tracker);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[worker] subscription refresh failed", err);
        reportEvent({
          key: "worker:sub-refresh",
          severity: "warning",
          title: "Worker subscription refresh failed",
          message: "DB query for active subscriptions failed. New sign-ups won't be picked up until next refresh.",
          fields: [{ name: "error", value: describeError(err, 400) }],
        });
      }
    })();
  }, 60_000);

  try {
    const { pollAndDispatch } = await import("@/channels/dispatcher");
    dispatchInterval = setInterval(() => {
      void pollAndDispatch().catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[worker] pollAndDispatch failed", err);
        reportEvent({
          key: "worker:dispatch",
          severity: "warning",
          title: "Channel dispatcher poll failed",
          message: "pollAndDispatch threw. Notifications may be delayed until next tick.",
          fields: [{ name: "error", value: describeError(err, 400) }],
        });
      });
    }, 2_000);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[worker] channel dispatcher module not available", err);
    reportEvent({
      key: "worker:dispatch:boot",
      severity: "critical",
      title: "Channel dispatcher failed to load",
      message: "Could not import @/channels/dispatcher. Events will be written but never delivered.",
      fields: [{ name: "error", value: describeError(err, 400) }],
    });
  }

  const watchedCount = Array.from(watchedByNetwork.values()).reduce((a, l) => a + l.length, 0);
  // eslint-disable-next-line no-console
  console.log(`[worker] up - watching ${watchedCount} validators on ${consumers.size} network(s)`);
}

async function shutdown(signal: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`[worker] received ${signal}, shutting down`);
  for (const handle of consumers.values()) handle.stop();
  consumers.clear();
  if (subRefreshInterval) clearInterval(subRefreshInterval);
  if (dispatchInterval) clearInterval(dispatchInterval);
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

installProcessGuards("worker");

bootWorker().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[worker] boot failed", err);
  reportEvent({
    key: "worker:boot",
    severity: "critical",
    title: "Worker boot failed",
    message: "bootWorker() threw. Block stream did not start. Process is alive but idle — investigate and restart.",
    fields: [{ name: "error", value: describeError(err, 600) }],
  });
});
