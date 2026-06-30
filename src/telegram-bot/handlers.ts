import { prisma } from "@/lib/db";
import type { ChannelConfig } from "@/types/channels";

/**
 * Minimal subset of grammy's Context that handlers actually need.
 * Decoupling here keeps handlers unit-testable without booting a Bot.
 */
export interface BotChat {
  id: number | string;
}

export interface BotUser {
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface HandlerContext {
  chat?: BotChat;
  from?: BotUser;
  match?: string | RegExpMatchArray;
  message?: { text?: string };
  reply: (text: string) => Promise<unknown>;
}

const HELP_TEXT =
  "/start <code>: pair with dashboard\n" +
  "/stop: disable notifications\n" +
  "/help: show this";

const GENERIC_ERROR =
  "Something went wrong handling that command. Please try again or generate a new pairing link from the dashboard.";

const INVALID_PAIRING =
  "This pairing link is invalid or expired. Generate a new one in the dashboard.";

const PAIRED_OK =
  "Paired with validator notifications. You'll receive alerts here.";

const STOP_OK =
  "Notifications paused. Re-pair from the dashboard to resume.";

const STOP_NONE =
  "No active Telegram notifications found for this chat.";

function welcomeMessage(): string {
  const url = process.env.PUBLIC_URL?.trim();
  const dest = url && url.length > 0 ? url : "your dashboard";
  return `Hi! I send Celestia validator alerts. Configure me from your dashboard at ${dest}.`;
}

function extractToken(ctx: HandlerContext): string {
  if (typeof ctx.match === "string") {
    return ctx.match.trim();
  }
  if (Array.isArray(ctx.match) && ctx.match[0]) {
    return String(ctx.match[0]).trim();
  }
  // Fallback: parse from raw message text "/start <token>"
  const text = ctx.message?.text ?? "";
  const parts = text.split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ").trim() : "";
}

function chatIdString(ctx: HandlerContext): string | null {
  if (!ctx.chat || ctx.chat.id === undefined || ctx.chat.id === null) {
    return null;
  }
  return ctx.chat.id.toString();
}

function chatTitleFrom(ctx: HandlerContext): string | null {
  const from = ctx.from;
  if (!from) return null;
  if (from.username) return `@${from.username}`;
  const name = [from.first_name, from.last_name]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(" ")
    .trim();
  return name.length > 0 ? name : null;
}

/**
 * /start [token] - deep-link pairing handler.
 *
 * - No token   → welcome.
 * - Invalid    → "invalid or expired".
 * - Expired    → "invalid or expired".
 * - Consumed   → "invalid or expired".
 * - Valid      → atomically marks pairing consumed AND writes chatId into
 *                Channel.config (read-merge-write to preserve any templates
 *                Wave 1 / dashboard already populated).
 */
export async function handleStart(ctx: HandlerContext): Promise<void> {
  try {
    const token = extractToken(ctx);
    if (!token) {
      await ctx.reply(welcomeMessage());
      return;
    }

    const chatId = chatIdString(ctx);
    if (!chatId) {
      await ctx.reply(GENERIC_ERROR);
      return;
    }

    const pairing = await prisma.telegramPairing.findUnique({
      where: { token },
    });

    const now = new Date();
    if (!pairing || pairing.consumed || pairing.expiresAt < now) {
      await ctx.reply(INVALID_PAIRING);
      return;
    }

    const chatTitle = chatTitleFrom(ctx);

    if (pairing.channelId) {
      // Channel-scoped: write chatId directly to the existing Channel and
      // consume the pairing in one transaction.
      const channel = await prisma.channel.findUnique({
        where: { id: pairing.channelId },
        include: { subscription: true },
      });
      if (!channel) {
        await ctx.reply(INVALID_PAIRING);
        return;
      }

      // Refuse pairing if this chat is already tracking the same validator
      // through any other channel (cross-wallet duplicate-destination rule).
      const others = await prisma.channel.findMany({
        where: {
          type: "telegram",
          subscription: {
            validatorId: channel.subscription.validatorId,
            network: channel.subscription.network,
          },
          NOT: { id: channel.id },
        },
        select: { config: true },
      });
      const collides = others.some(
        (c) => ((c.config ?? {}) as ChannelConfig).chatId === chatId,
      );
      if (collides) {
        const collisionMsg =
          "This chat is already tracking that validator from another alert. Remove the existing one first or pair from a different Telegram chat.";
        await prisma.$transaction([
          prisma.telegramPairing.update({
            where: { token },
            data: { consumed: true, error: collisionMsg },
          }),
          prisma.channel.update({
            where: { id: channel.id },
            data: { lastErrorAt: new Date(), lastErrorMsg: collisionMsg },
          }),
        ]);
        await ctx.reply(collisionMsg);
        return;
      }

      const existingConfig = (channel.config ?? {}) as ChannelConfig;
      const mergedConfig: ChannelConfig = {
        ...existingConfig,
        chatId,
        ...(chatTitle ? { chatTitle } : {}),
      };

      // Now that chatId is resolved, populate destKey so the partial
      // unique on (validatorNetKey, destKey) starts protecting this
      // channel. validatorNetKey was set when the row was created.
      const destKey = `telegram:${chatId}`;

      await prisma.$transaction([
        prisma.telegramPairing.update({
          where: { token },
          data: {
            consumed: true,
            ...(chatTitle ? { chatTitle } : {}),
          },
        }),
        prisma.channel.update({
          where: { id: pairing.channelId },
          data: {
            config: mergedConfig as unknown as object,
            enabled: true,
            destKey,
          },
        }),
      ]);

      await ctx.reply(PAIRED_OK);
    } else {
      // Wallet-scoped: no Channel exists yet. Stash the chatId on the
      // pairing row so POST /api/subscriptions can resolve it when the
      // user finishes the create form. Do NOT mark consumed - that flips
      // when the subscription is created.
      await prisma.telegramPairing.update({
        where: { token },
        data: {
          chatId,
          ...(chatTitle ? { chatTitle } : {}),
        },
      });
      await ctx.reply(PAIRED_OK);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[telegram-bot] /start failed", err);
    try {
      await ctx.reply(GENERIC_ERROR);
    } catch {
      // swallow - we already logged the original error
    }
  }
}

/**
 * /stop - disables every Telegram channel bound to this chat.
 *
 * Uses Prisma's Postgres JSON path filter on Channel.config.chatId.
 */
export async function handleStop(ctx: HandlerContext): Promise<void> {
  try {
    const chatId = chatIdString(ctx);
    if (!chatId) {
      await ctx.reply(GENERIC_ERROR);
      return;
    }

    const result = await prisma.channel.updateMany({
      where: {
        type: "telegram",
        config: {
          path: ["chatId"],
          equals: chatId,
        },
      },
      data: { enabled: false },
    });

    if (result.count === 0) {
      await ctx.reply(STOP_NONE);
      return;
    }

    await ctx.reply(STOP_OK);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[telegram-bot] /stop failed", err);
    try {
      await ctx.reply(GENERIC_ERROR);
    } catch {
      // swallow
    }
  }
}

/** /help - static command reference. */
export async function handleHelp(ctx: HandlerContext): Promise<void> {
  try {
    await ctx.reply(HELP_TEXT);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[telegram-bot] /help failed", err);
  }
}

/** Catch-all: log unknown messages, no reply (per spec). */
export async function handleUnknown(ctx: HandlerContext): Promise<void> {
  const chatId = chatIdString(ctx) ?? "<no-chat>";
  const text = ctx.message?.text ?? "<non-text>";
  // eslint-disable-next-line no-console
  console.log(`[telegram-bot] unknown message from chat=${chatId}: ${text}`);
}

export const messages = {
  HELP_TEXT,
  GENERIC_ERROR,
  INVALID_PAIRING,
  PAIRED_OK,
  STOP_OK,
  STOP_NONE,
  welcomeMessage,
};
