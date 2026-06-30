"use client";

import type { Keplr } from "@keplr-wallet/types";

export function getKeplr(): Keplr | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { keplr?: Keplr }).keplr;
}

export interface KeplrSignature {
  address: string;
  /** base64 secp256k1 pubkey (StdSignature pub_key.value) */
  pubKey: string;
  /** base64 ADR-036 signature */
  signature: string;
}

/**
 * Enable the chain in Keplr, read the active key, and sign `message` via
 * ADR-036 `signArbitrary`. Throws a user-facing Error if Keplr is missing or
 * the user rejects.
 */
export async function keplrGetAddress(chainId: string): Promise<string> {
  const keplr = getKeplr();
  if (!keplr) throw new Error("Keplr extension not found. Install it to continue.");
  await keplr.enable(chainId);
  const key = await keplr.getKey(chainId);
  return key.bech32Address;
}

export async function keplrSign(
  chainId: string,
  address: string,
  message: string,
): Promise<KeplrSignature> {
  const keplr = getKeplr();
  if (!keplr) throw new Error("Keplr extension not found. Install it to continue.");
  const res = await keplr.signArbitrary(chainId, address, message);
  return {
    address,
    pubKey: res.pub_key.value,
    signature: res.signature,
  };
}
