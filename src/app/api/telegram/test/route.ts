import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api-helpers";
import { rateLimit } from "@/lib/ratelimit";
import { readSession } from "@/lib/session";
import telegramAdapter from "@/channels/telegram";
import type { ChannelRecord, ValidatorContext } from "@/types/channels";
import type { ValidatorEvent, EventType, Severity } from "@/types/events";
import type { ChannelTestResponse } from "@/lib/api-types";

const EVENT_TYPES = [
  "skip",
  "offline",
  "recovered",
  "delegate",
  "undelegate",
  "commission_changed",
] as const;

const SEVERITY_FOR: Record<EventType, Severity> = {
  skip: "warning",
  offline: "critical",
  recovered: "info",
  delegate: "info",
  undelegate: "info",
  commission_changed: "info",
};

/**
 * POST /api/telegram/test
 *
 * Send a test message to a paired Telegram chat. Used by the pair-button
 * "Send test" action so the user can confirm the bot delivers to their
 * chat before (or after) submitting the create form.
 *
 * Body:
 *  - { token: string }     - wallet-scoped: pairing must have chatId set
 *  - { channelId: string } - channel-scoped: looks up Channel.config.chatId
 */
const TestRequestSchema = z.intersection(
  z.union([
    z.object({ token: z.string().min(1) }),
    z.object({ channelId: z.string().min(1) }),
  ]),
  z.object({
    eventType: z.enum(EVENT_TYPES).optional(),
    /**
     * Per-event templates from the in-progress form. When provided,
     * overrides anything stored on the Channel row. The dispatcher's
     * production path uses Channel.config.templates; this lets the user
     * preview an unsaved edit before clicking Save.
     */
    templates: z
      .partialRecord(z.enum(EVENT_TYPES), z.string().max(500))
      .optional(),
    rawTemplate: z.boolean().optional(),
  }),
);

export async function POST(req: Request): Promise<NextResponse> {
  const rl = await rateLimit(req, "telegram:test", { rpm: 10 });
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

  const parsed = TestRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid_body", "Request body failed validation", {
      issues: parsed.error.issues,
    });
  }

  const eventType: EventType = parsed.data.eventType ?? "skip";
  let resolvedChatId: string | null = null;
  if ("token" in parsed.data) {
    const pairing = await prisma.telegramPairing.findUnique({
      where: { token: parsed.data.token },
    });
    if (!pairing) {
      return jsonError(404, "pairing_not_found", "Unknown pairing token");
    }
    if (!pairing.chatId) {
      return jsonError(
        400,
        "pairing_pending",
        "Open the bot and run /start first.",
      );
    }
    if (pairing.expiresAt < new Date()) {
      return jsonError(400, "pairing_expired", "Pairing token expired");
    }
    if (pairing.walletAddress) {
      const session = await readSession(req).catch(() => null);
      if (!session) {
        return jsonError(401, "unauthenticated", "Connect your wallet first.");
      }
      if (
        session.addr.toLowerCase() !== pairing.walletAddress.toLowerCase()
      ) {
        return jsonError(
          403,
          "forbidden",
          "Pairing belongs to a different wallet.",
        );
      }
    }
    resolvedChatId = pairing.chatId;
  } else {
    // Channel-scoped: only the wallet that owns the channel may test it.
    const session = await readSession(req).catch(() => null);
    if (!session) {
      return jsonError(401, "unauthenticated", "Connect your wallet first.");
    }
    const channel = await prisma.channel.findUnique({
      where: { id: parsed.data.channelId },
      include: { subscription: true },
    });
    if (!channel || channel.type !== "telegram") {
      return jsonError(404, "channel_not_found", "Telegram channel not found");
    }
    if (
      channel.subscription.walletAddress.toLowerCase() !==
      session.addr.toLowerCase()
    ) {
      return jsonError(403, "forbidden", "Channel belongs to a different wallet.");
    }
    const cfg = (channel.config ?? {}) as { chatId?: string };
    if (!cfg.chatId) {
      return jsonError(
        400,
        "channel_unpaired",
        "This channel hasn't been paired yet.",
      );
    }
    resolvedChatId = cfg.chatId;
  }

  const synthEvent: ValidatorEvent = {
    validatorId: 1n,
    network: "mainnet",
    type: eventType,
    severity: SEVERITY_FOR[eventType] ?? "info",
    payload: samplePayload(eventType),
    blockNumber: 12345678n,
    occurredAt: new Date(),
    dedupKey: `tg-pair-test:${eventType}:${Date.now()}`,
  };
  const synthValidator: ValidatorContext = {
    id: 1n,
    network: "mainnet",
    name: "Test Validator",
    authAddress: "0x0000000000000000000000000000000000000000",
  };
  const ephemeral: ChannelRecord = {
    id: "tg-pair-test",
    type: "telegram",
    config: {
      chatId: resolvedChatId,
      ...(parsed.data.templates ? { templates: parsed.data.templates } : {}),
      ...(parsed.data.rawTemplate !== undefined
        ? { rawTemplate: parsed.data.rawTemplate }
        : {}),
    },
    enabled: true,
    // Test-only record routed directly through the adapter (bypasses
    // dispatch's group filter); events list is unused but required by
    // ChannelRecord.
    events: ["slotSkip", "offline", "delegation", "commission"],
  };

  try {
    await telegramAdapter.send(ephemeral, synthEvent, synthValidator);
    const resp: ChannelTestResponse = { ok: true };
    return NextResponse.json(resp);
  } catch (err) {
    const resp: ChannelTestResponse = {
      ok: false,
      error: sanitize((err as Error).message),
    };
    return NextResponse.json(resp);
  }
}

function sanitize(msg: string): string {
  return msg
    .replace(/https?:\/\/\S+/gu, "<url>")
    .replace(/[A-Za-z0-9_-]{32,}/gu, "<redacted>")
    .slice(0, 500);
}

function samplePayload(t: EventType): Record<string, unknown> {
  switch (t) {
    case "offline":
      return { consecutiveSkips: 5 };
    case "delegate":
    case "undelegate":
      return {
        delegator: "0x1111111111111111111111111111111111111111",
        amount: "1000000000000000000",
      };
    case "commission_changed":
      return {
        oldCommission: "100000000000000000",
        newCommission: "120000000000000000",
      };
    default:
      return {};
  }
}
