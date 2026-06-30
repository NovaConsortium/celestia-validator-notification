import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/**
 * Short-lived HMAC-signed token proving the holder verified ownership of
 * a phone number or email address. Format: `${base64url(payload)}.${base64url(hmac)}`.
 *
 * Payload JSON shape: `{ k: "phone"|"email", v: value, e: expiresAtMs }`.
 * The `k` discriminator means a phone token can't be replayed against
 * the email channel and vice versa. The HMAC is computed over the
 * encoded payload string (post-base64url) so we don't rely on JSON
 * canonical form.
 *
 * Secret source: `CHANNEL_ENCRYPTION_KEY` (re-used). If the env var is
 * 64-char hex, decoded to raw 32 bytes; otherwise SHA-256 derived (mirrors
 * the encryption module's permissive fallback for local dev).
 */

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

type Kind = "phone" | "email";

interface Payload {
  k: Kind;
  v: string;
  e: number; // expiresAt ms epoch
}

let cachedSecret: Buffer | null = null;

function getSecret(): Buffer {
  if (cachedSecret) return cachedSecret;
  const raw = process.env.CHANNEL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "CHANNEL_ENCRYPTION_KEY env var is not set; required for verified-token HMAC",
    );
  }
  if (/^[0-9a-fA-F]{64}$/u.test(raw)) {
    cachedSecret = Buffer.from(raw, "hex");
  } else {
    cachedSecret = createHash("sha256").update(raw).digest();
  }
  return cachedSecret;
}

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/u, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_");
}

function b64urlDecode(str: string): Buffer {
  const padded = str.replace(/-/gu, "+").replace(/_/gu, "/");
  const pad = padded.length % 4 === 0 ? 0 : 4 - (padded.length % 4);
  return Buffer.from(padded + "=".repeat(pad), "base64");
}

function sign(payloadEncoded: string): string {
  const mac = createHmac("sha256", getSecret())
    .update(payloadEncoded, "utf8")
    .digest();
  return b64urlEncode(mac);
}

function issue(kind: Kind, value: string, ttlMs?: number): string {
  if (!value || typeof value !== "string") {
    throw new Error(`issueVerifiedToken: value is required for kind=${kind}`);
  }
  const exp = Date.now() + (ttlMs ?? DEFAULT_TTL_MS);
  const payload: Payload = { k: kind, v: value, e: exp };
  const encoded = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = sign(encoded);
  return `${encoded}.${sig}`;
}

function verify(
  token: string,
  expectedKind: Kind,
  expectedValue: string,
): { valid: boolean; expired?: boolean } {
  if (typeof token !== "string" || !token.includes(".")) {
    return { valid: false };
  }
  const [encoded, sig] = token.split(".", 2);
  if (!encoded || !sig) return { valid: false };

  let expectedSigBuf: Buffer;
  let providedSigBuf: Buffer;
  try {
    expectedSigBuf = b64urlDecode(sign(encoded));
    providedSigBuf = b64urlDecode(sig);
  } catch {
    return { valid: false };
  }
  if (
    expectedSigBuf.length !== providedSigBuf.length ||
    !timingSafeEqual(expectedSigBuf, providedSigBuf)
  ) {
    return { valid: false };
  }

  let payload: Payload;
  try {
    const decoded = b64urlDecode(encoded).toString("utf8");
    const obj = JSON.parse(decoded) as unknown;
    if (
      !obj ||
      typeof obj !== "object" ||
      typeof (obj as Payload).k !== "string" ||
      typeof (obj as Payload).v !== "string" ||
      typeof (obj as Payload).e !== "number"
    ) {
      return { valid: false };
    }
    payload = obj as Payload;
  } catch {
    return { valid: false };
  }

  if (payload.k !== expectedKind) return { valid: false };
  if (payload.v !== expectedValue) return { valid: false };
  if (Date.now() > payload.e) return { valid: false, expired: true };
  return { valid: true };
}

/**
 * Issue a verifiedToken authorising the holder to attach an SMS / voice
 * channel for `phone`. Default TTL is 30 minutes.
 */
export function issueVerifiedToken(phone: string, ttlMs?: number): string {
  return issue("phone", phone, ttlMs);
}

/**
 * Validate a phone verifiedToken. Returns `{ valid: true }` only when
 * the HMAC matches, the embedded value equals `expectedPhone`, the
 * embedded kind is "phone", and the token has not expired.
 */
export function verifyVerifiedToken(
  token: string,
  expectedPhone: string,
): { valid: boolean; expired?: boolean } {
  return verify(token, "phone", expectedPhone);
}

/**
 * Issue a verifiedToken authorising the holder to attach an email
 * channel for `email`. Default TTL is 30 minutes.
 */
export function issueEmailVerifiedToken(email: string, ttlMs?: number): string {
  return issue("email", email.toLowerCase(), ttlMs);
}

/**
 * Validate an email verifiedToken. Same semantics as the phone variant
 * but scoped to `kind="email"`. Email is lowercased for comparison.
 */
export function verifyEmailVerifiedToken(
  token: string,
  expectedEmail: string,
): { valid: boolean; expired?: boolean } {
  return verify(token, "email", expectedEmail.toLowerCase());
}

/** Test helper. */
export function __resetVerifiedTokenSecret(): void {
  cachedSecret = null;
}
