import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import {
  generateNonce,
  setNonceCookie,
  signNonceToken,
} from "@/lib/nonce-cookie";

/**
 * GET /api/auth/nonce
 * Issues a fresh nonce and binds it to the browser via a short-lived signed
 * cookie. The client must put the same nonce inside the sign-in message it
 * signs; /api/auth/verify only accepts a message whose nonce matches the
 * cookie.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const rl = await rateLimit(req, "auth:nonce", { rpm: 30 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "retry-after": String(rl.retryAfter ?? 60) } },
    );
  }

  try {
    const nonce = generateNonce();
    const token = await signNonceToken(nonce);
    const res = NextResponse.json({ nonce });
    setNonceCookie(res, token);
    return res;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[auth/nonce] failed:", (err as Error).message);
    return NextResponse.json(
      { error: "config_error", message: "Auth unavailable. Check SESSION_SECRET." },
      { status: 500 },
    );
  }
}
