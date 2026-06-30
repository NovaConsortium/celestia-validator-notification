import { NextResponse } from "next/server";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { jsonError } from "@/lib/api-helpers";
import { issueEmailVerifiedToken } from "@/lib/verified-token";
import { hashOtp } from "../start/route";

/**
 * POST /api/email/verify/confirm
 *  - body: { email, code }
 *  - looks up the most recent non-expired EmailOtp row
 *  - increments attempts BEFORE comparing so a malicious client can't
 *    grind for free; >5 attempts → mark expired + 429
 *  - on match: delete row, return signed verifiedToken (30-min TTL)
 */
const APPROVED_TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const ConfirmSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u, "email must be a valid address"),
  code: z.string().regex(/^\d{4,10}$/u, "code must be 4-10 digits"),
});

export async function POST(req: Request): Promise<NextResponse> {
  const rl = await rateLimit(req, "email:verify:confirm", { rpm: 10 });
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
    return jsonError(400, "invalid_json", "Request body must be JSON");
  }
  const parsed = ConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid_body", "Request body failed validation", {
      issues: parsed.error.issues,
    });
  }
  const { email, code } = parsed.data;

  const now = new Date();
  const row = await prisma.emailOtp.findFirst({
    where: { email, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  if (!row) {
    return jsonError(
      404,
      "no_pending_verification",
      "No pending verification for this email. Start a new one.",
    );
  }

  const newAttempts = row.attempts + 1;
  if (newAttempts > MAX_ATTEMPTS) {
    await prisma.emailOtp
      .delete({ where: { id: row.id } })
      .catch(() => {
        /* best-effort */
      });
    return NextResponse.json(
      { error: "too_many_attempts", message: "Too many verification attempts" },
      { status: 429 },
    );
  }
  await prisma.emailOtp.update({
    where: { id: row.id },
    data: { attempts: newAttempts },
  });

  const expectedHash = hashOtp(code, email);
  const a = Buffer.from(row.codeHash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  const ok = a.length === b.length && timingSafeEqual(a, b);

  if (!ok) {
    return jsonError(400, "invalid_code", "Invalid verification code");
  }

  // One-shot: delete the row so the code can't be reused.
  await prisma.emailOtp.delete({ where: { id: row.id } }).catch(() => {
    /* best-effort */
  });

  const verifiedToken = issueEmailVerifiedToken(email, APPROVED_TTL_MS);
  const expiresAt = new Date(Date.now() + APPROVED_TTL_MS);
  return NextResponse.json(
    { verifiedToken, expiresAt: expiresAt.toISOString() },
    { status: 200 },
  );
}
