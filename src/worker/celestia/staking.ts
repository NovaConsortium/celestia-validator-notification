/**
 * Staking-event detection for Celestia validators.
 *
 * Missed blocks come from the CometBFT commit set; delegations and commission
 * changes do not. Celenium has no per-validator delegation feed, but its
 * per-block messages endpoint is filterable by cosmos message type and carries
 * the target valoper, delegator, and amount:
 *
 *   GET /v1/block/{H}/messages?msg_type=MsgDelegate
 *     → [{ id, time, type, data:{ ValidatorAddress, DelegatorAddress,
 *           Amount:{ Amount(utia), Denom } }, tx:{ hash } }, …]
 *
 * We fetch the staking message types for the processed height and let the
 * worker match `valoper` against its watched set.
 */
import { chainFor, celeniumApiKey } from "@/lib/chain";
import type { Network } from "@/types/events";

export interface StakingMessage {
  /** Celenium message id — globally unique, used as the event dedup key. */
  id: string;
  type:
    | "MsgDelegate"
    | "MsgUndelegate"
    | "MsgBeginRedelegate"
    | "MsgEditValidator";
  /** ValidatorAddress (delegate / undelegate / edit). */
  valoper?: string;
  /** Redelegate source / destination valoper. */
  srcValoper?: string;
  dstValoper?: string;
  delegator?: string;
  /** Amount in base utia (delegate / undelegate / redelegate). */
  amountUtia?: string;
  /** New commission rate as a decimal fraction string, e.g. "0.06". */
  commissionRate?: string;
  txHash?: string;
  occurredAt: Date;
}

const DELEGATION_TYPES = [
  "MsgDelegate",
  "MsgUndelegate",
  "MsgBeginRedelegate",
] as const;
const COMMISSION_TYPE = "MsgEditValidator";

function headers(): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" };
  const key = celeniumApiKey();
  if (key) h.apikey = key;
  return h;
}

interface RawMsg {
  id?: number | string;
  type?: string;
  time?: string;
  data?: {
    ValidatorAddress?: string;
    ValidatorSrcAddress?: string;
    ValidatorDstAddress?: string;
    DelegatorAddress?: string;
    Amount?: { Amount?: string; Denom?: string };
    CommissionRate?: string | null;
  };
  tx?: { hash?: string };
}

function normalize(m: RawMsg): StakingMessage | null {
  if (m.id === undefined || m.id === null || !m.type) return null;
  const d = m.data ?? {};
  return {
    id: String(m.id),
    type: m.type as StakingMessage["type"],
    valoper: d.ValidatorAddress,
    srcValoper: d.ValidatorSrcAddress,
    dstValoper: d.ValidatorDstAddress,
    delegator: d.DelegatorAddress,
    amountUtia: d.Amount?.Amount,
    commissionRate: d.CommissionRate ?? undefined,
    txHash: m.tx?.hash,
    occurredAt: m.time ? new Date(m.time) : new Date(),
  };
}

async function fetchByType(
  height: number,
  network: Network,
  msgType: string,
): Promise<StakingMessage[]> {
  const base = chainFor(network).celeniumBase;
  // ponytail: single page of 100 per type per block. Blocks with >100 staking
  // messages of one type to watched validators are vanishingly rare; raise the
  // limit or paginate if that ever shows up missing events.
  const url = `${base}/v1/block/${height}/messages?msg_type=${msgType}&limit=100`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) return [];
  const raw = (await res.json()) as RawMsg[] | { data?: RawMsg[] };
  const arr = Array.isArray(raw) ? raw : (raw.data ?? []);
  const out: StakingMessage[] = [];
  for (const m of arr) {
    const n = normalize(m);
    if (n) out.push(n);
  }
  return out;
}

/**
 * Fetch the staking messages at `height` for the categories any watched
 * validator cares about. Throws on fetch failure so the caller can retry the
 * height (same contract as the commit fetch).
 */
export async function fetchStakingMessages(
  height: number,
  network: Network,
  want: { delegation: boolean; commission: boolean },
): Promise<StakingMessage[]> {
  const types: string[] = [];
  if (want.delegation) types.push(...DELEGATION_TYPES);
  if (want.commission) types.push(COMMISSION_TYPE);
  if (types.length === 0) return [];
  const batches = await Promise.all(
    types.map((t) => fetchByType(height, network, t)),
  );
  return batches.flat();
}
