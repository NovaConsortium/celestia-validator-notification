import { SignJWT, jwtVerify } from "jose";
import type { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

/**
 * Short-lived signed cookie holding the nonce that must match the wallet
 * message the client signs. Stateless - no Redis/DB. The nonce is the
 * single binding between /api/auth/nonce and /api/auth/verify, so a leaked
 * sign-in message cannot be replayed against a different browser.
 */

export const NONCE_COOKIE_NAME = "mvn_nonce";
const NONCE_TTL_SECONDS = 5 * 60;

/**
 * Cookie Secure flag. Browsers reject `Secure` cookies on plain HTTP, so
 * self-hosted deployments running on bare HTTP would never persist the
 * nonce / session cookie. Derive from PUBLIC_URL scheme; fall back to
 * NODE_ENV for the local dev case.
 */
function cookieSecure(): boolean {
  const url = process.env.PUBLIC_URL;
  if (url) return url.startsWith("https://");
  return process.env.NODE_ENV === "production";
}

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set (>=32 chars)");
  }
  return new TextEncoder().encode(secret);
}

export function generateNonce(): string {
  return randomBytes(16).toString("hex");
}

export async function signNonceToken(nonce: string): Promise<string> {
  return new SignJWT({ nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${NONCE_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function readNonceFromCookie(req: Request): Promise<string | null> {
  const header = req.headers.get("cookie");
  if (!header) return null;
  let token: string | null = null;
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq) === NONCE_COOKIE_NAME) {
      token = decodeURIComponent(part.slice(eq + 1));
      break;
    }
  }
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return typeof payload.nonce === "string" ? payload.nonce : null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[nonce-cookie] jwtVerify failed: ${(err as Error).name}: ${(err as Error).message}`,
    );
    return null;
  }
}

export function setNonceCookie(res: NextResponse, jwt: string): void {
  res.cookies.set({
    name: NONCE_COOKIE_NAME,
    value: jwt,
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: NONCE_TTL_SECONDS,
  });
}

export function clearNonceCookie(res: NextResponse): void {
  res.cookies.set({
    name: NONCE_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: 0,
  });
}
