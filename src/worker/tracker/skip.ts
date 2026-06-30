/**
 * Per-(validatorId, network) consecutive-skip state machine.
 *
 * Flow:
 * - SSE timeout → confirm via quorumCall(eth_getBlockByNumber) → if confirmed
 *   missed, increment counter and emit "skip" (when perSkipAlerts).
 * - Counter ≥ offlineAfterN AND !offlineEmitted → emit "offline" with stable
 *   dedupKey (so PagerDuty resolve works on recovery).
 * - SSE success after offline → emit "recovered" with same dedupKey, reset.
 *
 * Unconfirmable skips (no blockNumber on SSE event) are logged + dropped,
 * never advance the counter - better miss than false-alarm.
 */
import type { Network, ValidatorEvent } from "@/types/events";

/**
 * Tracker input: SSE slot event already resolved to an on-chain validatorId
 * by the worker layer. Carries `slot` (consensus round), `valId`, `status`,
 * and optional `blockNumber` (only present on successful finalization).
 */
export interface SlotEvent {
  slot: number;
  valId: bigint;
  status: "success" | "timeout";
  blockNumber?: bigint;
}

export interface ThresholdConfig {
  offlineAfterN: number;
  perSkipAlerts: boolean;
}

const DEFAULT_THRESHOLDS: ThresholdConfig = {
  offlineAfterN: 5,
  perSkipAlerts: true,
};

interface ValidatorState {
  consecutiveSkips: number;
  lastSeenSlot: number;
  offlineEmitted: boolean;
  dedupKey?: string;
}

type Emit = (e: ValidatorEvent) => Promise<void>;
type GetThresholds = (
  validatorId: bigint,
  network: Network,
) => Promise<Partial<ThresholdConfig> | null | undefined>;

const THRESHOLD_TTL_MS = 30_000;

interface ThresholdCacheEntry {
  value: ThresholdConfig;
  expiresAt: number;
}

export class SkipTracker {
  private state = new Map<string, ValidatorState>();
  private thresholdCache = new Map<string, ThresholdCacheEntry>();

  constructor(private getThresholds: GetThresholds) {}

  private key(validatorId: bigint, network: Network): string {
    return `${validatorId.toString()}:${network}`;
  }

  private async thresholdsFor(
    validatorId: bigint,
    network: Network,
  ): Promise<ThresholdConfig> {
    const k = this.key(validatorId, network);
    const cached = this.thresholdCache.get(k);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.value;

    let raw: Partial<ThresholdConfig> | null | undefined;
    try {
      raw = await this.getThresholds(validatorId, network);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[skip] thresholds lookup failed for ${k}`, err);
      raw = null;
    }
    const value: ThresholdConfig = {
      offlineAfterN: raw?.offlineAfterN ?? DEFAULT_THRESHOLDS.offlineAfterN,
      perSkipAlerts: raw?.perSkipAlerts ?? DEFAULT_THRESHOLDS.perSkipAlerts,
    };
    this.thresholdCache.set(k, { value, expiresAt: now + THRESHOLD_TTL_MS });
    return value;
  }

  private getOrInit(validatorId: bigint, network: Network): ValidatorState {
    const k = this.key(validatorId, network);
    let s = this.state.get(k);
    if (!s) {
      s = { consecutiveSkips: 0, lastSeenSlot: 0, offlineEmitted: false };
      this.state.set(k, s);
    }
    return s;
  }

  async onSlot(slot: SlotEvent, emit: Emit, network: Network): Promise<void> {
    const state = this.getOrInit(slot.valId, network);

    // Replay guard: the worker can re-process the same height on a gap
    // catch-up or partial reconnect. For the timeout path that would
    // double-count consecutiveSkips and fire a spurious offline alert. For
    // the success path, idempotent — but we still skip so the
    // recovered/reset side-effects only run once.
    if (slot.slot <= state.lastSeenSlot && state.lastSeenSlot > 0) {
      return;
    }
    state.lastSeenSlot = slot.slot;

    if (slot.status === "timeout") {
      // The CometBFT /commit signer set is authoritative for missed-block
      // detection: a bonded validator absent from the commit at height H
      // missed that block. The worker feeds that in as a "timeout".
      state.consecutiveSkips += 1;
      const thresholds = await this.thresholdsFor(slot.valId, network);

      if (thresholds.perSkipAlerts) {
        await emit({
          validatorId: slot.valId,
          network,
          type: "skip",
          severity: "warning",
          payload: {
            slot: slot.slot,
            consecutive_skips: state.consecutiveSkips,
          },
          blockNumber: slot.blockNumber,
          occurredAt: new Date(),
        });
      }

      if (
        state.consecutiveSkips >= thresholds.offlineAfterN &&
        !state.offlineEmitted
      ) {
        // Per-incident dedupKey: scoped to the slot that tipped this
        // validator into offline. Without the slot suffix every offline
        // incident for a validator would reuse the same key, so a second
        // offline (after recovery) would collide with the historical row
        // under @@unique([dedupKey, type]) and never be persisted.
        const dedupKey = `${slot.valId.toString()}:${network}:offline:${slot.slot}`;
        await emit({
          validatorId: slot.valId,
          network,
          type: "offline",
          severity: "critical",
          payload: {
            slot: slot.slot,
            consecutive_skips: state.consecutiveSkips,
          },
          blockNumber: slot.blockNumber,
          occurredAt: new Date(),
          dedupKey,
        });
        state.offlineEmitted = true;
        state.dedupKey = dedupKey;
      }
      return;
    }

    // status === "success"
    if (state.offlineEmitted) {
      await emit({
        validatorId: slot.valId,
        network,
        type: "recovered",
        severity: "info",
        payload: { slot: slot.slot },
        blockNumber: slot.blockNumber,
        occurredAt: new Date(),
        dedupKey: state.dedupKey,
      });
      state.offlineEmitted = false;
      state.dedupKey = undefined;
    }
    state.consecutiveSkips = 0;
  }

  /**
   * Prime in-memory state so a recovery alert can still fire after a worker
   * restart. Caller is expected to derive `dedupKey` from the most recent
   * persisted offline Event row for the validator (no matching recovered).
   * Without this, the first success SSE after restart silently resets the
   * counter and the subscriber never learns the validator came back.
   */
  seedOffline(validatorId: bigint, network: Network, dedupKey: string): void {
    const state = this.getOrInit(validatorId, network);
    state.offlineEmitted = true;
    state.dedupKey = dedupKey;
  }

  // Test helpers ------------------------------------------------------------
  _peekState(validatorId: bigint, network: Network): ValidatorState | undefined {
    return this.state.get(this.key(validatorId, network));
  }
}
