import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import { z } from "zod";
import { verifyCosmosSignIn } from "@/lib/cosmos-auth";
import {
  clearNonceCookie,
  readNonceFromCookie,
} from "@/lib/nonce-cookie";
import { setSessionCookie, signSession } from "@/lib/session";

const VerifySchema = z.object({
  address: z.string().min(1).max(128),
  message: z.string().min(1).max(4000),
  signature: z.string().min(1).max(1024),
  pubKey: z.string().min(1).max(1024),
});

function getRequestDomain(req: Request): string {
  // Must match what the client computed via window.location.host, which
  // includes the port for non-default ports (e.g. localhost:3000).
  const host = req.headers.get("host");
  if (host) return host;
  try {
    return new URL(req.url).host;
  } catch {
    return "localhost";
  }
}

/**
 * POST /api/auth/verify
 * Body: { address, message, signature, pubKey }
 * Verifies the Keplr ADR-036 signature against the nonce cookie. On success,
 * mints an httpOnly mvn_session cookie carrying the lowercased bech32
 * celestia1… address.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const rl = await rateLimit(req, "auth:verify", { rpm: 10 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "retry-after": String(rl.retryAfter ?? 60) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Body must be JSON" },
      { status: 400 },
    );
  }

  const parsed = VerifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: { issues: parsed.error.issues } },
      { status: 400 },
    );
  }

  const expectedNonce = await readNonceFromCookie(req);
  if (!expectedNonce) {
    const cookieHeader = req.headers.get("cookie") ?? "";
    const hasNonceCookie = cookieHeader.includes("mvn_nonce=");
    // eslint-disable-next-line no-console
    console.error(
      `[auth/verify] missing_nonce: cookie_present=${hasNonceCookie} cookie_header_len=${cookieHeader.length}`,
    );
    return NextResponse.json(
      { error: "missing_nonce", message: "Request a fresh nonce and retry." },
      { status: 400 },
    );
  }

  const expectedDomain = getRequestDomain(req);

  let result;
  try {
    result = verifyCosmosSignIn({
      address: parsed.data.address,
      message: parsed.data.message,
      signature: parsed.data.signature,
      pubKey: parsed.data.pubKey,
      expectedNonce,
      expectedDomain,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[auth/verify] failed:", (err as Error).message);
    return NextResponse.json({ error: "verify_failed" }, { status: 500 });
  }

  if (!result.ok || !result.address) {
    const status = result.error === "expired" ? 400 : 401;
    const res = NextResponse.json({ error: result.error ?? "bad_signature" }, { status });
    clearNonceCookie(res);
    return res;
  }

  let jwt: string;
  try {
    jwt = await signSession({ addr: result.address });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[auth/verify] sign failed:", (err as Error).message);
    return NextResponse.json({ error: "config_error" }, { status: 500 });
  }

  const res = NextResponse.json({ address: result.address });
  setSessionCookie(res, jwt);
  clearNonceCookie(res);
  return res;
}
