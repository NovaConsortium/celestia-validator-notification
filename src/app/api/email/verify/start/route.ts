import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash, randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Resend } from "resend";
import { prisma } from "@/lib/db";
import { rateLimit, rateLimitByKey, getClientIp } from "@/lib/ratelimit";
import { jsonError } from "@/lib/api-helpers";
import { pruneExpiredEmailOtps } from "@/lib/cleanup";

const NOVA_CID = "nova-logo";

let novaBytesCache: Buffer | null | undefined;
async function loadNovaBytes(): Promise<Buffer | null> {
  if (novaBytesCache !== undefined) return novaBytesCache;
  try {
    novaBytesCache = await readFile(
      join(process.cwd(), "public", "nova.png"),
    );
    return novaBytesCache;
  } catch {
    novaBytesCache = null;
    return null;
  }
}

/**
 * POST /api/email/verify/start
 *  - body: { email }
 *  - generates a 6-digit OTP, stores its sha256 in `EmailOtp` (10-min TTL),
 *    and sends it via Resend.
 *  - rate-limited per-IP and per-email so the service can't be weaponised
 *    to spam strangers' inboxes.
 */

const TTL_MS = 10 * 60 * 1000;
const OTP_DIGITS = 6;
const DEFAULT_FROM = "Nova Consortium Alerts <alerts@novaconsortium.xyz>";

const SKIP_RATE_LIMIT = process.env.NODE_ENV !== "production";

const StartSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u, "email must be a valid address"),
});

let cachedClient: Resend | null = null;
function getClient(): Resend {
  if (cachedClient) return cachedClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  cachedClient = new Resend(key);
  return cachedClient;
}

function getOtpSecret(): string {
  const raw = process.env.CHANNEL_ENCRYPTION_KEY;
  if (!raw) throw new Error("CHANNEL_ENCRYPTION_KEY is not set");
  return raw;
}

export function hashOtp(code: string, email: string): string {
  return createHash("sha256")
    .update(`${code}:${email.toLowerCase()}:${getOtpSecret()}`)
    .digest("hex");
}

function generateCode(): string {
  // randomInt is uniform; pad to OTP_DIGITS.
  const max = 10 ** OTP_DIGITS;
  return String(randomInt(0, max)).padStart(OTP_DIGITS, "0");
}

function otpEmailHtml(code: string, embedLogo: boolean): string {
  // Email clients strip @font-face, so the Neue Haas brand font won't
  // load. Fall back to Helvetica Neue (Apple Mail), Helvetica, then
  // Arial — the mass-market substitutes Neue Haas was designed against.
  const fontStack =
    "'Neue Haas Grotesk Display Pro','Helvetica Neue',Helvetica,Arial,sans-serif";
  const logoCell = embedLogo
    ? `<td style="vertical-align:middle;"><img src="cid:${NOVA_CID}" alt="" width="28" height="28" style="display:block;border:0;border-radius:6px;" /></td>`
    : "";
  return `<!DOCTYPE html>
<html><body style="font-family:${fontStack};background:#f5f5f7;margin:0;padding:24px;color:#111;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="480" style="max-width:480px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;padding:32px 28px;">
<tr><td>
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
${logoCell}
<td style="vertical-align:middle;${embedLogo ? "padding-left:10px;" : ""}font-family:${fontStack};font-size:13px;font-weight:700;letter-spacing:0.04em;color:#111;text-transform:uppercase;">
Nova Consortium
</td>
</tr>
</table>
<h1 style="font-family:${fontStack};font-size:22px;font-weight:700;margin:18px 0 8px;color:#111;">Confirm your email</h1>
<p style="font-family:${fontStack};font-size:15px;line-height:1.55;color:#374151;margin:0 0 20px;">Enter this code in the Nova Consortium dashboard to start receiving validator alerts at this address.</p>
<div style="font-family:${fontStack};font-size:34px;font-weight:700;letter-spacing:0.18em;color:#111;background:#f5f5f7;border-radius:10px;padding:18px 0;text-align:center;">${code}</div>
<p style="font-family:${fontStack};font-size:12px;color:#6b7280;margin:18px 0 0;">This code expires in 10 minutes. If you didn't request it, you can ignore this email.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!SKIP_RATE_LIMIT) {
    const ipRl = await rateLimit(req, "email:verify:start", { rpm: 6, burst: 3 });
    if (!ipRl.ok) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: ipRl.retryAfter },
        { status: 429, headers: { "retry-after": String(ipRl.retryAfter ?? 60) } },
      );
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", "Request body must be JSON");
  }
  const parsed = StartSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid_body", "Request body failed validation", {
      issues: parsed.error.issues,
    });
  }
  const { email } = parsed.data;

  if (!SKIP_RATE_LIMIT) {
    const emailRl = rateLimitByKey(`email:verify:start:email:${email}`, {
      rpm: 2,
      burst: 1,
    });
    if (!emailRl.ok) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: emailRl.retryAfter },
        { status: 429, headers: { "retry-after": String(emailRl.retryAfter ?? 30) } },
      );
    }
  }

  const code = generateCode();
  const codeHash = hashOtp(code, email);
  const expiresAt = new Date(Date.now() + TTL_MS);
  const ip = getClientIp(req);

  // Best-effort prune of globally-expired rows so the table self-cleans
  // without a separate scheduler. Fires in the background.
  pruneExpiredEmailOtps();

  // Invalidate any prior pending rows for this email so confirm always
  // targets the freshest issued code.
  await prisma.emailOtp
    .deleteMany({ where: { email } })
    .catch(() => {
      /* best-effort */
    });

  await prisma.emailOtp.create({
    data: {
      email,
      codeHash,
      ipAddress: ip === "unknown" ? null : ip,
      expiresAt,
    },
  });

  const from = process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;
  const replyTo = process.env.EMAIL_REPLY_TO?.trim() || from;

  try {
    const client = getClient();
    const novaBytes = await loadNovaBytes();
    const { error } = await client.emails.send({
      from,
      to: [email],
      subject: "Your Nova Consortium verification code",
      html: otpEmailHtml(code, novaBytes !== null),
      replyTo,
      ...(novaBytes
        ? {
            attachments: [
              {
                filename: "nova.png",
                content: novaBytes.toString("base64"),
                contentType: "image/png",
                contentId: NOVA_CID,
              },
            ],
          }
        : {}),
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error(`[email:verify:start] resend error: ${error.message}`);
      return jsonError(502, "send_failed", "Could not send verification email");
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[email:verify:start] send threw:", (err as Error).message);
    return jsonError(502, "send_failed", "Could not send verification email");
  }

  return NextResponse.json(
    { ok: true, expiresAt: expiresAt.toISOString() },
    { status: 200 },
  );
}
