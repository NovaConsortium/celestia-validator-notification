/**
 * Compatibility shim: the read-path pages were written against the original
 * `ValidatorMetadata` shape. Rather than rewrite every page at once, this
 * module sources data from Celenium and maps it onto `ValidatorMetadata`.
 * New code should import `@/lib/celenium` directly.
 *
 * Field mapping (Celestia → ValidatorMetadata):
 *   valoper      → authAddress   (the validator's public address)
 *   moniker      → name
 *   stake (utia) → stake
 *   jailed       → status ("Jailed" | "Active")
 */
import type { Network } from "@/types/events";
import type { ValidatorMetadata } from "@/lib/api-types";
import {
  fetchValidators,
  fetchValidatorById as celeniumById,
  type CelestiaValidator,
} from "@/lib/celenium";
import { resolveAvatars } from "@/lib/keybase";

function toMetadata(v: CelestiaValidator, logo?: string): ValidatorMetadata {
  return {
    id: v.id,
    network: v.network,
    authAddress: v.valoper ?? v.consAddress,
    name: v.moniker,
    stake: v.stake,
    status: v.jailed ? "Jailed" : "Active",
    logo,
  };
}

export async function fetchValidatorMetadata(
  network: Network = "mainnet",
): Promise<ValidatorMetadata[]> {
  const vals = await fetchValidators(network);
  const avatars = await resolveAvatars(vals.map((v) => v.identity));
  return vals.map((v) =>
    toMetadata(v, v.identity ? avatars.get(v.identity) : undefined),
  );
}

export async function fetchValidatorById(
  id: string,
  network: Network = "mainnet",
): Promise<ValidatorMetadata | null> {
  const v = await celeniumById(id, network);
  if (!v) return null;
  const avatars = await resolveAvatars([v.identity]);
  return toMetadata(v, v.identity ? avatars.get(v.identity) : undefined);
}
