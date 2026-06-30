/**
 * Cosmos (Keplr / ADR-036) sign-in verification. Replaces the EVM SIWE flow.
 * Server-only — imports `@keplr-wallet/cosmos`. The message builder lives in
 * `@/lib/sign-in-message` so the client can build messages without pulling in
 * the crypto dependency.
 *
 * The client asks Keplr to `signArbitrary(chainId, address, message)` over the
 * exact string `buildSignInMessage` produces. ADR-036 wraps that string in a
 * fixed `sign/MsgSignData` amino doc; `verifyADR36Amino` reconstructs the same
 * doc, derives the address from the supplied pubkey, and checks the signature.
 */
import { verifyADR36Amino } from "@keplr-wallet/cosmos";
import { CELESTIA_BECH32_PREFIX, signInField } from "@/lib/sign-in-message";

export type CosmosVerifyError =
  | "malformed"
  | "wrong_domain"
  | "wrong_nonce"
  | "wrong_address"
  | "expired"
  | "bad_signature";

export interface CosmosVerifyResult {
  ok: boolean;
  address?: string;
  error?: CosmosVerifyError;
}

/**
 * Verify a Keplr ADR-036 sign-in. `pubKey` and `signature` are base64
 * (exactly what `window.keplr.signArbitrary` returns). Enforces domain,
 * nonce, expiry, address↔pubkey binding, and signature validity.
 */
export function verifyCosmosSignIn(opts: {
  message: string;
  signature: string;
  pubKey: string;
  address: string;
  expectedNonce: string;
  expectedDomain: string;
}): CosmosVerifyResult {
  const { message, address } = opts;

  if (!address.startsWith(`${CELESTIA_BECH32_PREFIX}1`)) {
    return { ok: false, error: "wrong_address" };
  }
  if (signInField(message, "Address") !== address) {
    return { ok: false, error: "wrong_address" };
  }
  if (signInField(message, "Domain") !== opts.expectedDomain) {
    return { ok: false, error: "wrong_domain" };
  }
  if (signInField(message, "Nonce") !== opts.expectedNonce) {
    return { ok: false, error: "wrong_nonce" };
  }

  const expiry = signInField(message, "Expiry");
  const expiryMs = expiry ? Date.parse(expiry) : NaN;
  if (Number.isNaN(expiryMs)) return { ok: false, error: "malformed" };
  if (expiryMs < Date.now()) return { ok: false, error: "expired" };

  let pubKeyBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    pubKeyBytes = new Uint8Array(Buffer.from(opts.pubKey, "base64"));
    sigBytes = new Uint8Array(Buffer.from(opts.signature, "base64"));
  } catch {
    return { ok: false, error: "malformed" };
  }

  let valid = false;
  try {
    // verifyADR36Amino derives the address from pubKeyBytes using the given
    // prefix and checks it equals `address`, then verifies the signature over
    // the ADR-036 sign doc wrapping `message`.
    valid = verifyADR36Amino(
      CELESTIA_BECH32_PREFIX,
      address,
      message,
      pubKeyBytes,
      sigBytes,
    );
  } catch {
    return { ok: false, error: "bad_signature" };
  }
  if (!valid) return { ok: false, error: "bad_signature" };

  return { ok: true, address: address.toLowerCase() };
}
