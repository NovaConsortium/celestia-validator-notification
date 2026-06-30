import { prisma } from "@/lib/db";
import { parseChannelEvents } from "@/lib/api-helpers";
import { reportEvent } from "@/lib/monitoring";
import {
  isChannelGroupAllowed,
  type ChannelAdapter,
  type ChannelConfig,
  type ChannelRecord,
  type ChannelType,
  type EventGroupKey,
  type ValidatorContext,
} from "@/types/channels";
import type {
  EventType,
  Network,
  Severity,
  ValidatorEvent,
} from "@/types/events";
import discord from "./discord";
import slack from "./slack";
import telegram from "./telegram";
import pagerduty from "./pagerduty";
import email from "./email";

export interface DispatchResult {
  channelId: string;
  ok: boolean;
  /** True when the channel was filtered out (per-sub alertConfig or
   *  per-channel events array). No delivery attempted, no error. */
  suppressed?: boolean;
  error?: string;
}

/**
 * Subset of AlertConfig the dispatcher needs. Kept local rather than
 * importing the full type so the worker doesn't pull the zod schema
 * graph in. Mirrors src/lib/api-types.ts AlertConfigSchema.
 */
export interface AlertConfigLike {
  slotSkip?: boolean;
  offline?: boolean;
  offlineAfterN?: number;
  delegation?: boolean;
  delegationMinTia?: number;
  commission?: boolean;
}

const ADAPTERS: Record<ChannelType, ChannelAdapter> = {
  discord,
  slack,
  telegram,
  pagerduty,
  email,
};

const RETRY_DELAYS_MS = [1_000, 3_000, 9_000];

/**
 * Persistent dispatcher cursor key in the WorkerCursor table. Survives
 * worker restarts so non-idempotent adapters do not re-deliver the last
 * ~60s of events on every bounce.
 */
const CURSOR_KEY = "dispatcher:lastEventId";

/**
 * After this many consecutive failed delivery attempts, the channel is
 * flipped to enabled=false and the reason is persisted in lastErrorMsg.
 * The user can re-enable manually via the dashboard once they have
 * fixed the destination.
 */
export const CHANNEL_AUTO_DISABLE_THRESHOLD = 5;

/**
 * Map raw EventType (6 values) to the 4 logical groups the user picks
 * routing for in the UI. Channels store the group keys; dispatch filters
 * channels whose `events` array contains the firing event's group.
 */
const EVENT_GROUP: Record<EventType, EventGroupKey> = {
  skip: "slotSkip",
  offline: "offline",
  recovered: "offline",
  delegate: "delegation",
  undelegate: "delegation",
  commission_changed: "commission",
};

export function getAdapter(type: ChannelType): ChannelAdapter | undefined {
  return ADAPTERS[type];
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run an adapter's send/resolve with up to 3 attempts.
 * Backoff: 1s/3s/9s between attempts. Throws final error on exhaustion.
 */
async function withRetry(fn: () => Promise<void>): Promise<void> {
  let lastErr: unknown = null;
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    try {
      await fn();
      return;
    } catch (err) {
      lastErr = err;
      if (i < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[i]);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function persistFailure(
  channelId: string,
  channelType: string,
  message: string,
): Promise<void> {
  // eslint-disable-next-line no-console
  console.error(`[dispatcher] ${channelType} channel ${channelId} failed: ${message}`);
  reportEvent({
    key: `channel:${channelType}:${channelId}`,
    severity: "warning",
    title: `Channel delivery failed (${channelType})`,
    message,
    fields: [
      { name: "channelId", value: channelId },
      { name: "type", value: channelType },
    ],
  });
  try {
    // Increment the failure counter atomically, then flip enabled=false
    // when the threshold is reached. Two writes because Prisma's
    // increment can't be combined with a conditional `enabled` set.
    const updated = await prisma.channel.update({
      where: { id: channelId },
      data: {
        consecutiveFailures: { increment: 1 },
        lastErrorAt: new Date(),
        lastErrorMsg: message.slice(0, 500),
      },
      select: { consecutiveFailures: true, enabled: true },
    });
    if (
      updated.enabled &&
      updated.consecutiveFailures >= CHANNEL_AUTO_DISABLE_THRESHOLD
    ) {
      const disableMsg =
        `Auto-disabled after ${updated.consecutiveFailures} consecutive failures: ` +
        message.slice(0, 400);
      await prisma.channel.update({
        where: { id: channelId },
        data: { enabled: false, lastErrorMsg: disableMsg },
      });
      // Surface as a separate observability event so dashboards can
      // distinguish "delivery failed once" from "channel disabled".
      reportEvent({
        key: `channel:${channelType}:${channelId}:disabled`,
        severity: "warning",
        title: `Channel auto-disabled (${channelType})`,
        message: `Channel ${channelId} disabled after ${updated.consecutiveFailures} consecutive failures. User must re-enable manually.`,
        fields: [
          { name: "channelId", value: channelId },
          { name: "type", value: channelType },
        ],
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[dispatcher] failed to persist channel error:", err);
  }
}

/**
 * Mark a successful delivery by resetting consecutiveFailures to 0.
 * Skipped when the row is already at 0 to avoid a write per healthy
 * dispatch — read first, write only on transition.
 */
async function persistSuccess(channelId: string): Promise<void> {
  try {
    await prisma.channel
      .updateMany({
        where: { id: channelId, consecutiveFailures: { gt: 0 } },
        data: { consecutiveFailures: 0, lastErrorMsg: null, lastErrorAt: null },
      })
      .catch(() => {
        /* noop */
      });
  } catch {
    /* noop */
  }
}

/**
 * Map raw EventType to the sub-level alertConfig key that gates whether
 * a subscription receives this event. Mirrors EVENT_GROUP but operates
 * on the broader alertConfig field names.
 *
 * The check is "user-explicit opt-out wins": only `false` suppresses;
 * `undefined` and `true` deliver. This preserves backward compatibility
 * with rows persisted before some keys existed.
 */
function isAllowedBySubscription(
  event: ValidatorEvent,
  cfg: AlertConfigLike,
): boolean {
  switch (event.type) {
    case "skip":
      // slotSkip historically required explicit `true` (worker tracker
      // uses `=== true`). Mirror that here so toggle-off in the UI
      // actually suppresses delivery.
      return cfg.slotSkip === true;
    case "offline": {
      if (cfg.offline === false) return false;
      // Per-sub offlineAfterN threshold. The tracker fires offline at
      // the smallest threshold across all subs of a validator; here we
      // suppress delivery for subs whose own threshold is higher than
      // the observed consecutive_skips. Default mirrors tracker default.
      const observed = Number(
        (event.payload as { consecutive_skips?: unknown }).consecutive_skips ??
          0,
      );
      const threshold =
        typeof cfg.offlineAfterN === "number" && cfg.offlineAfterN > 0
          ? cfg.offlineAfterN
          : 5;
      return Number.isFinite(observed) && observed >= threshold;
    }
    case "recovered":
      // Recovered tracks the offline gate but cannot apply the
      // offlineAfterN check (recovered payload only carries `slot`).
      // Treating recovered as gated by `offline !== false` matches
      // the channel-events default and avoids stranded incidents in
      // dashboards.
      return cfg.offline !== false;
    case "delegate":
    case "undelegate": {
      // Opt-in like slotSkip. Enforce this sub's own delegationMinTia against
      // the event amount (utia in payload), so each sub's threshold is exact
      // even though the worker emits at the loosest threshold.
      if (cfg.delegation !== true) return false;
      const amtUtia = Number(
        (event.payload as { amount?: unknown }).amount ?? 0,
      );
      const minUtia =
        (typeof cfg.delegationMinTia === "number" ? cfg.delegationMinTia : 0) *
        1_000_000;
      return Number.isFinite(amtUtia) && amtUtia >= minUtia;
    }
    case "commission_changed":
      return cfg.commission === true;
  }
}

/**
 * Dispatch one event to a subscription's channels. Failures are isolated
 * per channel: one bad channel does not stop the others. After retries
 * are exhausted the failure is persisted on the Channel row and the
 * consecutiveFailures counter is incremented; the channel auto-disables
 * once CHANNEL_AUTO_DISABLE_THRESHOLD is reached.
 *
 * Subscription-level gating is applied here so user-facing alertConfig
 * toggles (slotSkip / offline / offlineAfterN / delegation / commission)
 * are honored even though the worker emits one Event row per validator.
 * Per-sub offlineAfterN is enforced for "offline" events using the
 * consecutive_skips count in the event payload.
 *
 * For PagerDuty + recovered events, calls adapter.resolve() instead of
 * adapter.send() so PD closes the corresponding incident.
 */
export async function dispatch(
  event: ValidatorEvent,
  validator: ValidatorContext,
  channels: ChannelRecord[],
  alertConfig: AlertConfigLike,
): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];
  const group = EVENT_GROUP[event.type];

  // Subscription-level gate: if the user disabled this event group on
  // the subscription (or its per-sub threshold isn't met), nothing on
  // this sub fires. Channels are not iterated at all in that case.
  if (!isAllowedBySubscription(event, alertConfig)) {
    for (const channel of channels) {
      results.push({ channelId: channel.id, ok: true, suppressed: true });
    }
    return results;
  }

  await Promise.all(
    channels.map(async (channel) => {
      if (!channel.enabled) {
        results.push({ channelId: channel.id, ok: true, suppressed: true });
        return;
      }
      // Per-event routing: skip channels not subscribed to this group.
      // Undefined `events` (legacy rows pre-migration, ad-hoc test
      // fixtures) → fall through to receive everything, matching the
      // schema default and prior fan-out behavior. No persisted error
      // when filtered out — this is intentional configuration.
      if (channel.events && !channel.events.includes(group)) {
        results.push({ channelId: channel.id, ok: true, suppressed: true });
        return;
      }
      if (!isChannelGroupAllowed(channel.type, group)) {
        results.push({ channelId: channel.id, ok: true, suppressed: true });
        return;
      }
      const adapter = ADAPTERS[channel.type];
      if (!adapter) {
        const msg = `unknown channel type: ${channel.type}`;
        results.push({ channelId: channel.id, ok: false, error: msg });
        await persistFailure(channel.id, channel.type, msg);
        return;
      }

      const isResolve =
        channel.type === "pagerduty" &&
        event.type === "recovered" &&
        typeof adapter.resolve === "function";

      try {
        await withRetry(async () => {
          if (isResolve) {
            await adapter.resolve!(channel, event, validator);
          } else {
            await adapter.send(channel, event, validator);
          }
        });
        results.push({ channelId: channel.id, ok: true });
        await persistSuccess(channel.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ channelId: channel.id, ok: false, error: msg });
        await persistFailure(channel.id, channel.type, msg);
      }
    }),
  );

  return results;
}

/* ---------------- DB-backed polling fallback ---------------- */

/**
 * In-process cache of the cursor row to avoid an extra read per tick
 * once the worker is warm. Loaded lazily from WorkerCursor on the first
 * pollAndDispatch call so we recover after worker restarts.
 */
let cachedLastSeenEventId: string | null = null;
let cursorLoaded = false;

interface PrismaEventRow {
  id: string;
  validatorId: bigint;
  network: string;
  type: string;
  severity: string;
  payload: unknown;
  blockNumber: bigint | null;
  occurredAt: Date;
  dedupKey: string | null;
}

interface PrismaValidatorRow {
  id: bigint;
  network: string;
  valoper: string | null;
  name: string | null;
}

interface PrismaChannelRow {
  id: string;
  type: string;
  config: unknown;
  enabled: boolean;
  events?: unknown;
}

interface PrismaSubRow {
  id: string;
  validatorId: bigint;
  network: string;
  alertConfig: unknown;
  channels: PrismaChannelRow[];
}

function rowToEvent(row: PrismaEventRow): ValidatorEvent {
  return {
    id: row.id,
    validatorId: row.validatorId,
    network: row.network as Network,
    type: row.type as EventType,
    severity: row.severity as Severity,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    blockNumber: row.blockNumber ?? undefined,
    occurredAt: row.occurredAt,
    dedupKey: row.dedupKey ?? undefined,
  };
}

function rowToValidator(row: PrismaValidatorRow): ValidatorContext {
  return {
    id: row.id,
    network: row.network as Network,
    authAddress: row.valoper ?? "",
    name: row.name ?? undefined,
  };
}

function rowToChannel(row: PrismaChannelRow): ChannelRecord {
  return {
    id: row.id,
    type: row.type as ChannelType,
    config: (row.config ?? {}) as ChannelConfig,
    enabled: row.enabled,
    events: parseChannelEvents(row.events),
  };
}

/**
 * Load the persisted cursor on first call so worker restarts do not
 * replay the last ~60s of events. Cached in-process afterwards;
 * writes to the row also update the cache to stay consistent.
 */
async function loadCursor(): Promise<string | null> {
  if (cursorLoaded) return cachedLastSeenEventId;
  try {
    const row = await prisma.workerCursor.findUnique({
      where: { key: CURSOR_KEY },
    });
    cachedLastSeenEventId = row?.value ?? null;
  } catch (err) {
    // Fail-open: missing cursor falls back to the 60s window. Logged so
    // ops can spot DB issues but does not block dispatch.
    // eslint-disable-next-line no-console
    console.warn(
      `[dispatcher] cursor load failed: ${(err as Error).message}`,
    );
    cachedLastSeenEventId = null;
  }
  cursorLoaded = true;
  return cachedLastSeenEventId;
}

async function saveCursor(eventId: string): Promise<void> {
  cachedLastSeenEventId = eventId;
  try {
    await prisma.workerCursor.upsert({
      where: { key: CURSOR_KEY },
      create: { key: CURSOR_KEY, value: eventId },
      update: { value: eventId },
    });
  } catch (err) {
    // Cache still reflects the latest event so the loop makes progress;
    // a missed persistence is recovered by the next successful write.
    // eslint-disable-next-line no-console
    console.warn(
      `[dispatcher] cursor save failed: ${(err as Error).message}`,
    );
  }
}

/**
 * Safety-net poller: read Events newer than the last seen id, dispatch each
 * to all enabled channels of every matching Subscription, then update the
 * high-water mark in WorkerCursor. Worker should call this every 2s.
 */
export async function pollAndDispatch(): Promise<void> {
  const prismaAny = prisma as unknown as {
    event: {
      findMany: (args: unknown) => Promise<PrismaEventRow[]>;
    };
    validator: {
      findUnique: (args: unknown) => Promise<PrismaValidatorRow | null>;
    };
    subscription: {
      findMany: (args: unknown) => Promise<PrismaSubRow[]>;
    };
  };

  const lastSeenEventId = await loadCursor();

  const events = await prismaAny.event.findMany({
    where: lastSeenEventId
      ? { id: { gt: lastSeenEventId } }
      : { occurredAt: { gte: new Date(Date.now() - 60_000) } },
    orderBy: { id: "asc" },
    take: 100,
  });

  for (const row of events) {
    const event = rowToEvent(row);
    const validatorRow = await prismaAny.validator.findUnique({
      where: {
        id_network: { id: event.validatorId, network: event.network },
      },
    });
    if (!validatorRow) {
      // Validator row missing — advance the cursor anyway so we don't
      // re-process it forever. Worker is the sole writer of Event and
      // Validator should exist, but be defensive.
      await saveCursor(row.id);
      continue;
    }
    const validator = rowToValidator(validatorRow);

    const subs = await prismaAny.subscription.findMany({
      where: { validatorId: event.validatorId, network: event.network },
      include: { channels: true },
    });

    for (const sub of subs) {
      const channels = sub.channels.map(rowToChannel);
      const alertConfig = (sub.alertConfig ?? {}) as AlertConfigLike;
      await dispatch(event, validator, channels, alertConfig);
    }

    await saveCursor(row.id);
  }
}
