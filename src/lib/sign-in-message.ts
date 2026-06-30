/**
 * Pure, dependency-free helpers for the Keplr sign-in message. Safe to import
 * from both client and server (no crypto deps — keeps the browser bundle
 * small). Verification lives in `@/lib/cosmos-auth` (server-only).
 */

/** bech32 account prefix for Celestia (mainnet + Mocha both use this). */
export const CELESTIA_BECH32_PREFIX = "celestia";

const STATEMENT =
  "Sign in to Nova Consortium Validator Alerts. This is an off-chain message — no transaction, no funds move, no approvals. Your Celestia address labels your saved alerts so they follow you across devices.";

export interface SignInMessageParts {
  address: string;
  domain: string;
  nonce: string;
  /** Minutes until the message expires. Default 10. */
  ttlMinutes?: number;
}

/** Build the canonical plaintext the user signs with Keplr. */
export function buildSignInMessage(parts: SignInMessageParts): string {
  const now = new Date();
  const expiry = new Date(now.getTime() + (parts.ttlMinutes ?? 10) * 60_000);
  return [
    STATEMENT,
    "",
    `Address: ${parts.address}`,
    `Domain: ${parts.domain}`,
    `Nonce: ${parts.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiry: ${expiry.toISOString()}`,
  ].join("\n");
}

/** Read a single `Name: value` line out of a sign-in message. */
export function signInField(message: string, name: string): string | null {
  const m = message.match(new RegExp(`^${name}: (.+)$`, "mu"));
  return m ? m[1].trim() : null;
}
