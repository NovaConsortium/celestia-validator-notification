/**
 * Celenium REST client (Celestia indexer).
 *
 * Validator identity on Celestia:
 * - `id`         — Celenium numeric validator id (stored as our Validator.id)
 * - `consAddress`— hex consensus address (uppercase), matches CometBFT commit
 *                  signatures; the key the worker uses to detect missed blocks
 * - `valoper`    — bech32 celestiavaloper1… (display / explorer links)
 */
import { chainFor, celeniumApiKey } from "@/lib/chain";
import type { Network } from "@/types/events";

export interface CelestiaValidator {
  id: string; // numeric id as string (parity with how the app keys validators)
  network: Network;
  consAddress: string; // uppercase hex
  valoper?: string;
  moniker?: string;
  commission?: string; // rate, e.g. "0.1"
  stake?: string; // base utia
  votingPower?: string;
  jailed: boolean;
  website?: string;
  identity?: string;
  details?: string;
}

interface RawValidator {
  id?: number | string;
  cons_address?: string;
  moniker?: string;
  rate?: string;
  stake?: string;
  voting_power?: string;
  jailed?: boolean;
  website?: string;
  identity?: string;
  details?: string;
  address?: { hash?: string };
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" };
  const key = celeniumApiKey();
  if (key) h.apikey = key;
  return h;
}

function normalize(v: RawValidator, network: Network): CelestiaValidator | null {
  if (v.id === undefined || v.id === null || !v.cons_address) return null;
  return {
    id: String(v.id),
    network,
    consAddress: v.cons_address.toUpperCase(),
    valoper: v.address?.hash,
    moniker: v.moniker,
    commission: v.rate,
    stake: v.stake,
    votingPower: v.voting_power,
    jailed: v.jailed === true,
    website: v.website,
    identity: v.identity,
    details: v.details,
  };
}

/**
 * Fetch the full validator list (paginated, 100/page). Cached 60s by Next.js
 * when called from a server component; the worker calls it ad-hoc.
 */
export async function fetchValidators(
  network: Network = "mainnet",
): Promise<CelestiaValidator[]> {
  const base = chainFor(network).celeniumBase;
  const out: CelestiaValidator[] = [];
  let offset = 0;
  const limit = 100;
  try {
    for (;;) {
      const url = `${base}/v1/validators?limit=${limit}&offset=${offset}`;
      const res = await fetch(url, { headers: headers(), next: { revalidate: 60 } });
      if (!res.ok) break;
      const raw = (await res.json()) as RawValidator[] | { data?: RawValidator[] };
      const arr = Array.isArray(raw) ? raw : (raw.data ?? []);
      if (arr.length === 0) break;
      for (const v of arr) {
        const n = normalize(v, network);
        if (n) out.push(n);
      }
      if (arr.length < limit) break;
      offset += limit;
    }
  } catch {
    // degrade to whatever we collected (empty → empty-state page)
  }
  return out;
}

export async function fetchValidatorById(
  id: string,
  network: Network = "mainnet",
): Promise<CelestiaValidator | null> {
  const base = chainFor(network).celeniumBase;
  try {
    const res = await fetch(`${base}/v1/validators/${id}`, {
      headers: headers(),
      next: { revalidate: 60 },
    });
    if (res.ok) {
      const raw = (await res.json()) as RawValidator;
      return normalize(raw, network);
    }
  } catch {
    /* fall through */
  }
  // Fallback: filter the list (some deployments lack the per-id route).
  const all = await fetchValidators(network);
  return all.find((v) => v.id === id) ?? null;
}

export interface ValidatorUptime {
  uptime?: string; // fraction "0.99"
  blocks?: { height: number; signed: boolean }[];
}

export async function fetchValidatorUptime(
  id: string,
  network: Network = "mainnet",
  limit = 100,
): Promise<ValidatorUptime | null> {
  const base = chainFor(network).celeniumBase;
  try {
    const res = await fetch(`${base}/v1/validators/${id}/uptime?limit=${limit}`, {
      headers: headers(),
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    return (await res.json()) as ValidatorUptime;
  } catch {
    return null;
  }
}
