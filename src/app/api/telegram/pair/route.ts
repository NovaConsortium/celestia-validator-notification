import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import {
  TelegramPairRequestSchema,
  type TelegramPairResponse,
} from "@/lib/api-types";
import { jsonError } from "@/lib/api-helpers";
import { readSession } from "@/lib/session";
import { pruneExpiredTelegramPairings } from "@/lib/cleanup";

const PAIRING_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * POST /api/telegram/pair
 *
 * Three modes:
 *  - {channelId}      Attach a token to an existing Telegram Channel row.
 *                     Bot writes chatId directly to that channel on /start.
 *  - {subscriptionId} Create (or reuse) a Telegram Channel row under the
 *                     owned subscription, then attach a token. Used on the
 *                     /manage page when a user adds a Telegram channel
 *                     before saving.
 *  - {} (empty)       Wallet-scoped: bind the token to the wallet.
 *                     No Channel row exists yet. Bot writes chatId to the
 *                     pairing record itself; POST /api/subscriptions later
 *                     resolves the token → chatId at create time.
 *
 * Returns deep-link `https://t.me/<bot>?start=<token>`. `channelId` is
 * present in the response for the channel/subscription paths only.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const rl = await rateLimit(req, "telegram:pair", { rpm: 10 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "retry-after": String(rl.retryAfter ?? 60) } },
    );
  }

  let body: unknown = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    return jsonError(400, "invalid_json", "Request body must be JSON");
  }

  const parsed = TelegramPairRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid_body", "Request body failed validation", {
      issues: parsed.error.issues,
    });
  }
  const data = parsed.data;

  const usernameRaw = process.env.TELEGRAM_BOT_USERNAME;
  if (!usernameRaw) {
    return jsonError(
      503,
      "bot_unconfigured",
      "TELEGRAM_BOT_USERNAME env var is not set",
    );
  }
  // Accept either `bot_name` or `@bot_name` in the env var; t.me URLs
  // must NOT include the leading @.
  const username = usernameRaw.replace(/^@+/, "");

  const token = randomBytes(8).toString("hex");
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  const deepLink = `https://t.me/${username}?start=${token}`;

  let resolvedChannelId: string | null = null;
  let walletAddress: string | null = null;

  if ("channelId" in data) {
    const ch = await prisma.channel.findUnique({ where: { id: data.channelId } });
    if (!ch) return jsonError(404, "channel_not_found", "Channel not found");
    if (ch.type !== "telegram") {
      return jsonError(400, "wrong_type", "Channel is not a telegram channel");
    }
    resolvedChannelId = ch.id;
    // Clear any stale pairing-failure state so the poll can treat a non-null
    // lastErrorMsg as evidence of a fresh failure during this attempt.
    if (ch.lastErrorAt || ch.lastErrorMsg) {
      await prisma.channel.update({
        where: { id: ch.id },
        data: { lastErrorAt: null, lastErrorMsg: null },
      });
    }
  } else if ("subscriptionId" in data) {
    const session = await readSession(req).catch(() => null);
    if (!session) {
      return jsonError(
        401,
        "unauthenticated",
        "Connect your wallet to pair Telegram.",
      );
    }
    const sub = await prisma.subscription.findUnique({
      where: { id: data.subscriptionId },
    });
    if (!sub) {
      return jsonError(404, "subscription_not_found", "Subscription not found");
    }
    if (sub.walletAddress.toLowerCase() !== session.addr.toLowerCase()) {
      return jsonError(
        403,
        "forbidden",
        "This alert belongs to a different wallet.",
      );
    }
    const existing = await prisma.channel.findMany({
      where: { subscriptionId: sub.id, type: "telegram" },
      orderBy: { id: "asc" },
    });
    const reusable = existing.find((c) => {
      const cfg = (c.config ?? {}) as { chatId?: string };
      return !cfg.chatId;
    });
    if (reusable) {
      resolvedChannelId = reusable.id;
    } else {
      // Pre-pairing row has no chatId yet — destKey stays null so the
      // partial unique on (validatorNetKey, destKey) doesn't fire
      // against other half-configured Telegram rows. validatorNetKey
      // is set so the constraint kicks in the moment the bot writes
      // chatId during /start.
      const created = await prisma.channel.create({
        data: {
          subscriptionId: sub.id,
          type: "telegram",
          config: {},
          enabled: true,
          destKey: null,
          validatorNetKey: `${sub.network}:${sub.validatorId.toString()}`,
        },
      });
      resolvedChannelId = created.id;
    }
  } else {
    // Wallet-scoped path: token bound to the wallet, no Channel row.
    const session = await readSession(req).catch(() => null);
    if (!session) {
      return jsonError(
        401,
        "unauthenticated",
        "Connect your wallet to pair Telegram.",
      );
    }
    walletAddress = session.addr.toLowerCase();
  }

  // Best-effort prune of globally-expired pairings before issuing a new
  // token. Fire-and-forget — must not block the request.
  pruneExpiredTelegramPairings();

  await prisma.telegramPairing.create({
    data: {
      token,
      channelId: resolvedChannelId,
      walletAddress,
      expiresAt,
      consumed: false,
    },
  });

  const resp: TelegramPairResponse = {
    token,
    channelId: resolvedChannelId ?? undefined,
    expiresAt: expiresAt.toISOString(),
    deepLink,
  };
  return NextResponse.json(resp, { status: 201 });
}
