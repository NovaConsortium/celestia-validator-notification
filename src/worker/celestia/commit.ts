/**
 * CometBFT `/commit` fetcher — the canonical per-height signer set.
 *
 * A Celestia block's commit lists every active validator with a
 * `block_id_flag`: 2 = committed (signed), 1 = absent, 3 = nil. Absent
 * entries carry an empty `validator_address`, so we can only enumerate the
 * validators that DID sign. That is exactly what we need: a watched validator
 * whose consensus address is NOT in the signed set missed that height.
 */
import { chainFor } from "@/lib/chain";
import type { Network } from "@/types/events";

interface CommitSignature {
  block_id_flag?: number;
  validator_address?: string;
}

interface CommitResponse {
  result?: {
    signed_header?: {
      commit?: { height?: string; signatures?: CommitSignature[] };
    };
  };
}

const BLOCK_ID_FLAG_COMMIT = 2;

interface ValidatorsResponse {
  result?: {
    count?: string;
    total?: string;
    validators?: { address?: string }[];
  };
}

/**
 * Return the set of consensus addresses (uppercase hex) in the ACTIVE
 * (bonded) validator set at `height`. Used to distinguish "watched validator
 * is bonded but didn't sign" (a real miss) from "watched validator left the
 * active set" (jailed/unbonded — not a miss, stop feeding the tracker).
 * Paginates at 100/page in case the set ever exceeds 100.
 */
export async function fetchActiveSet(
  height: number | bigint,
  network: Network,
): Promise<Set<string>> {
  const base = chainFor(network).cometRpc;
  const out = new Set<string>();
  let page = 1;
  for (;;) {
    const url = `${base}/validators?height=${height.toString()}&per_page=100&page=${page}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`validators ${height} on ${network}: HTTP ${res.status}`);
    const json = (await res.json()) as ValidatorsResponse;
    const vals = json.result?.validators;
    if (!Array.isArray(vals)) throw new Error(`validators ${height} on ${network}: malformed`);
    for (const v of vals) {
      if (typeof v.address === "string" && v.address.length > 0) {
        out.add(v.address.toUpperCase());
      }
    }
    const total = Number(json.result?.total ?? out.size);
    if (out.size >= total || vals.length === 0) break;
    page += 1;
  }
  return out;
}

/**
 * Return the set of consensus addresses (uppercase hex) that SIGNED `height`.
 * Throws on network/parse failure so the caller can decide whether to retry —
 * we must never silently treat a fetch error as "everyone missed".
 */
export async function fetchSigners(
  height: number | bigint,
  network: Network,
): Promise<Set<string>> {
  const url = `${chainFor(network).cometRpc}/commit?height=${height.toString()}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`commit ${height} on ${network}: HTTP ${res.status}`);
  }
  const json = (await res.json()) as CommitResponse;
  const sigs = json.result?.signed_header?.commit?.signatures;
  if (!Array.isArray(sigs)) {
    throw new Error(`commit ${height} on ${network}: malformed response`);
  }
  const signers = new Set<string>();
  for (const s of sigs) {
    if (
      s.block_id_flag === BLOCK_ID_FLAG_COMMIT &&
      typeof s.validator_address === "string" &&
      s.validator_address.length > 0
    ) {
      signers.add(s.validator_address.toUpperCase());
    }
  }
  return signers;
}
