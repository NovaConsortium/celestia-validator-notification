import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  clearSessionCookie,
  verifySessionToken,
} from "@/lib/session";

/**
 * POST /api/auth/logout
 *
 *  - Clears the wallet session cookie.
 *  - Reads the current JWT, extracts its `jti`, and writes a
 *    RevokedSession row so the token is rejected even if it is later
 *    replayed from a stolen cookie before its natural exp.
 *  - Best-effort delete of expired RevokedSession rows so the table
 *    self-cleans without a separate scheduler.
 *
 * Cookie clearing happens unconditionally so a malformed token still
 * logs the user out client-side.
 */
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

export async function POST(req?: Request): Promise<NextResponse> {
  // `req` is optional so unit tests that just verify cookie clearing can
  // call POST() with no args. The Next.js runtime always provides one.
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);

  const token = req ? readCookie(req, SESSION_COOKIE_NAME) : null;
  if (token) {
    const session = await verifySessionToken(token).catch(() => null);
    if (session?.jti) {
      // Fall back to the maximum TTL when the token has no exp claim
      // (legacy / hand-crafted tokens). A slightly oversized expiry is
      // safe — cleanup-on-insert prunes it later.
      const expiresAt = new Date(
        (session.exp ?? Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS) *
          1000,
      );
      try {
        await prisma.revokedSession.upsert({
          where: { jti: session.jti },
          create: { jti: session.jti, expiresAt },
          update: { expiresAt },
        });
      } catch (err) {
        // Logout response still succeeds — cookie is cleared either way.
        // eslint-disable-next-line no-console
        console.warn(
          `[auth/logout] revocation insert failed: ${(err as Error).message}`,
        );
      }
      // Best-effort cleanup; failure is ignored.
      prisma.revokedSession
        .deleteMany({ where: { expiresAt: { lt: new Date() } } })
        .catch(() => {
          /* noop */
        });
    }
  }

  return res;
}
