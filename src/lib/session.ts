import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import type { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Wallet session - signed JWT in an httpOnly cookie. Payload is the
 * user's lowercased bech32 celestia1… address plus a random `jti` claim used
 * for revocation (see RevokedSession table). The JWT is signed with
 * SESSION_SECRET (HS256). Rotating the secret invalidates every session.
 *
 * Revocation cost: one indexed Prisma read per authenticated request.
 * For the self-host single-instance topology this is sub-ms after the
 * row is cached; if it ever becomes a hot spot, swap in an in-process
 * LRU keyed by jti with a short TTL.
 */

export const SESSION_COOKIE_NAME = "mvn_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** See nonce-cookie.ts cookieSecure() for rationale. */
function cookieSecure(): boolean {
  const url = process.env.PUBLIC_URL;
  if (url) return url.startsWith("https://");
  return process.env.NODE_ENV === "production";
}

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set (>=32 chars) for wallet auth - see scripts/setup.mjs",
    );
  }
  return new TextEncoder().encode(secret);
}

export interface Session {
  addr: string;
  /** JWT id used for revocation. Optional for forward-compat with legacy
   * tokens minted before the jti claim was introduced. */
  jti?: string;
  /** JWT exp claim (seconds since epoch). Used when writing a revocation
   * row so we know when the row can be GC'd. */
  exp?: number;
}

export async function signSession(payload: Session): Promise<string> {
  const jti = payload.jti ?? randomUUID();
  return new SignJWT({ addr: payload.addr })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (typeof payload.addr === "string" && payload.addr.startsWith("celestia1")) {
      const jti = typeof payload.jti === "string" ? payload.jti : undefined;
      const exp = typeof payload.exp === "number" ? payload.exp : undefined;
      return { addr: payload.addr, jti, exp };
    }
    return null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[session] jwtVerify failed: ${(err as Error).name}: ${(err as Error).message}`,
    );
    return null;
  }
}

/**
 * Check whether a given jti has been revoked. Tokens minted before the
 * revocation feature was added (no jti claim) are treated as not
 * revoked — they fall off naturally on JWT exp.
 */
async function isSessionRevoked(jti: string | undefined): Promise<boolean> {
  if (!jti) return false;
  try {
    const row = await prisma.revokedSession.findUnique({ where: { jti } });
    return row !== null;
  } catch (err) {
    // Fail-open on a DB blip so a transient outage doesn't lock everyone
    // out; the next request will re-check. The alternative (fail-closed)
    // would convert a DB hiccup into a forced logout for every user.
    // eslint-disable-next-line no-console
    console.warn(
      `[session] revocation check failed: ${(err as Error).message}`,
    );
    return false;
  }
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq) === name) {
      return decodeURIComponent(part.slice(eq + 1));
    }
  }
  return null;
}

/** Server-only: read & verify the session cookie from an incoming Request.
 *  Returns null when the token is missing, malformed, expired, or its jti
 *  has been revoked via /api/auth/logout. */
export async function readSession(req: Request): Promise<Session | null> {
  const token = readCookie(req, SESSION_COOKIE_NAME);
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session) return null;
  if (await isSessionRevoked(session.jti)) return null;
  return session;
}

export function setSessionCookie(res: NextResponse, jwt: string): void {
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: jwt,
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: 0,
  });
}
