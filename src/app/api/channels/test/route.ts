import { NextResponse } from "next/server";
import { ChannelTestSchema, type ChannelTestResponse } from "@/lib/api-types";
import { jsonError } from "@/lib/api-helpers";
import type { ChannelAdapter, ChannelRecord, ValidatorContext } from "@/types/channels";
import type { EventType, Severity, ValidatorEvent } from "@/types/events";
import { rateLimit, rateLimitByKey } from "@/lib/ratelimit";
import { verifyEmailVerifiedToken } from "@/lib/verified-token";
import { readSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { reportEvent } from "@/lib/monitoring";

import discordAdapter from "@/channels/discord";
import telegramAdapter from "@/channels/telegram";
import slackAdapter from "@/channels/slack";
import pagerdutyAdapter from "@/channels/pagerduty";
import emailAdapter from "@/channels/email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

// Skip rate limiting in local dev so iterative testing isn't blocked.
const SKIP_RATE_LIMIT = process.env.NODE_ENV !== "production";

/**
 * POST /api/channels/test
 *
 * Test-fire a notification through a channel adapter without persisting
 * the channel. Used by the dashboard "Send test message" button.
 *
 * Imports each adapter directly rather than going through the (still-
 * being-built) dispatcher to avoid coordination risk with channels-dev.
 */
const ADAPTERS: Record<string, ChannelAdapter> = {
  discord: discordAdapter,
  telegram: telegramAdapter,
  slack: slackAdapter,
  pagerduty: pagerdutyAdapter,
  email: emailAdapter,
};

const SEVERITY_FOR: Record<EventType, Severity> = {
  skip: "warning",
  offline: "critical",
  recovered: "info",
  delegate: "info",
  undelegate: "info",
  commission_changed: "info",
};

export async function POST(req: Request): Promise<NextResponse> {
  // General per-IP cooldown for any test fire. SMS / Voice get stricter caps below.
  if (!SKIP_RATE_LIMIT) {
    const rl = await rateLimit(req, "channels:test", { rpm: 6, burst: 3 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: rl.retryAfter },
        { status: 429, headers: { "retry-after": String(rl.retryAfter ?? 60) } },
      );
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", "Request body must be JSON");
  }
  const parsed = ChannelTestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid_body", "Request body failed validation", {
      issues: parsed.error.issues,
    });
  }
  const { channel, eventType, validator } = parsed.data;

  const adapter = ADAPTERS[channel.type];
  if (!adapter) {
    return jsonError(400, "unknown_channel_type", `Unknown channel type: ${channel.type}`);
  }

  // Email test fires also need ownership proof (verifiedToken matching
  // the email, or a saved DB channel of type "email" with the same
  // recipient on a wallet-owned subscription) so the service can't be
  // used to spam strangers' inboxes via the test button.
  if (channel.type === "email") {
    const rawTo = channel.config.to;
    const email = typeof rawTo === "string" ? rawTo.trim().toLowerCase() : "";
    if (!email || !EMAIL_RE.test(email)) {
      return jsonError(
        400,
        "invalid_email",
        "Enter a valid email address before sending a test.",
      );
    }

    if (!SKIP_RATE_LIMIT) {
      // 6/min per recipient with burst 3 — covers normal "send test,
      // check inbox, adjust template, send again" loop without 429-ing
      // on the second click. Still caps abuse (sub still bound by the
      // per-IP hourly cap below).
      const emailRl = rateLimitByKey(`channels:test:email:${email}`, {
        rpm: 6,
        burst: 3,
      });
      if (!emailRl.ok) {
        return NextResponse.json(
          { error: "rate_limited", retryAfter: emailRl.retryAfter },
          { status: 429, headers: { "retry-after": String(emailRl.retryAfter ?? 30) } },
        );
      }

      const ipKey = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        || req.headers.get("x-real-ip")
        || "unknown";
      const hourRl = rateLimitByKey(`channels:test:email:hour:${ipKey}`, {
        rpm: 20 / 60,
        burst: 20,
      });
      if (!hourRl.ok) {
        return NextResponse.json(
          { error: "rate_limited", retryAfter: hourRl.retryAfter },
          { status: 429, headers: { "retry-after": String(hourRl.retryAfter ?? 360) } },
        );
      }
    }

    let verified = false;
    const token = channel.config.verifiedToken;
    if (typeof token === "string" && token.length > 0) {
      verified = verifyEmailVerifiedToken(token, email).valid;
    }
    if (!verified && channel.id) {
      const session = await readSession(req).catch(() => null);
      if (session) {
        const dbCh = await prisma.channel
          .findUnique({
            where: { id: channel.id },
            include: { subscription: true },
          })
          .catch(() => null);
        const owner = dbCh?.subscription.walletAddress?.toLowerCase();
        const dbTo = (dbCh?.config as { to?: unknown } | null)?.to;
        if (
          dbCh &&
          owner === session.addr.toLowerCase() &&
          typeof dbTo === "string" &&
          dbTo.trim().toLowerCase() === email
        ) {
          verified = true;
        }
      }
    }
    if (!verified) {
      return jsonError(
        403,
        "email_not_verified",
        "Verify the email before sending a test: enter address, click Send code, type the OTP from the email, then click Verify.",
      );
    }
  }

  const synthEvent: ValidatorEvent = {
    validatorId: BigInt(validator?.id ?? "1"),
    network: validator?.network ?? "mainnet",
    type: eventType,
    severity: SEVERITY_FOR[eventType] ?? "info",
    payload: sampleEventPayload(eventType),
    blockNumber: 12345678n,
    occurredAt: new Date(),
    dedupKey: `test:${eventType}:${Date.now()}`,
  };

  const synthValidator: ValidatorContext = {
    id: synthEvent.validatorId,
    network: synthEvent.network,
    name: validator?.name ?? "Test Validator",
    authAddress: validator?.authAddress ?? "celestiavaloper1example",
  };

  // One-shot record - never persisted. Bypasses dispatch's group filter
  // (calls adapter.send directly), so events list is unused but required
  // by ChannelRecord.
  const ephemeralChannel: ChannelRecord = {
    id: "test",
    type: channel.type,
    config: channel.config,
    enabled: true,
    events: ["slotSkip", "offline", "delegation", "commission"],
  };

  try {
    await adapter.send(ephemeralChannel, synthEvent, synthValidator);
    const resp: ChannelTestResponse = { ok: true };
    return NextResponse.json(resp);
  } catch (err) {
    const rawMsg = (err as Error).message;
    const msg = sanitizeError(rawMsg);
    // eslint-disable-next-line no-console
    console.error(`[channels:test] ${channel.type} send failed: ${rawMsg}`);
    reportEvent({
      key: `channels:test:${channel.type}`,
      severity: "warning",
      title: `Test fire failed (${channel.type})`,
      message: msg,
      fields: [
        { name: "type", value: channel.type },
        { name: "eventType", value: eventType },
      ],
    });
    const resp: ChannelTestResponse = { ok: false, error: msg };
    return NextResponse.json(resp, { status: 200 });
  }
}

function sampleEventPayload(t: EventType): Record<string, unknown> {
  switch (t) {
    case "offline":
      return { consecutiveSkips: 5 };
    case "delegate":
    case "undelegate":
      return { delegator: "0x1111111111111111111111111111111111111111", amount: "1000000000000000000" };
    case "commission_changed":
      return { oldCommission: "100000000000000000", newCommission: "120000000000000000" };
    default:
      return {};
  }
}

/**
 * Strip secrets from error messages before bouncing back to the client.
 * Adapters may include URL fragments / tokens in error text.
 */
function sanitizeError(msg: string): string {
  return msg
    .replace(/https?:\/\/\S+/gu, "<url>")
    .replace(/[A-Za-z0-9_-]{32,}/gu, "<redacted>")
    .slice(0, 500);
}
