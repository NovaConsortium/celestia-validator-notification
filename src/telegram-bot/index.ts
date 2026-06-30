import { Bot } from "grammy";
import {
  handleStart,
  handleStop,
  handleHelp,
  handleUnknown,
  type HandlerContext,
} from "./handlers";
import {
  installProcessGuards,
  reportEvent,
  reportStatus,
  describeError,
} from "@/lib/monitoring";

/**
 * Standalone Telegram bot service.
 *
 * Long-polling mode (no webhook) so this works in any self-hosted topology
 * without exposing a public ingress for the bot. Communicates with the rest
 * of the system exclusively through the database - no shared in-process
 * state with the web/worker processes.
 */
async function bootBot(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.trim().length === 0) {
    // eslint-disable-next-line no-console
    console.error(
      "[telegram-bot] FATAL: TELEGRAM_BOT_TOKEN is required. Set it in the environment before starting the bot.",
    );
    process.exit(1);
  }

  const bot = new Bot(token);

  bot.command("start", (ctx) => handleStart(ctx as unknown as HandlerContext));
  bot.command("stop", (ctx) => handleStop(ctx as unknown as HandlerContext));
  bot.command("help", (ctx) => handleHelp(ctx as unknown as HandlerContext));

  // Catch-all for any other message (no reply, just log).
  bot.on("message", (ctx) => handleUnknown(ctx as unknown as HandlerContext));

  bot.catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[telegram-bot] unhandled error", err);
    reportEvent({
      key: "telegram-bot:handler-error",
      severity: "warning",
      title: "Telegram bot handler threw",
      message: describeError(err),
    });
  });

  const shutdown = async (signal: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log(`[telegram-bot] received ${signal}, stopping...`);
    try {
      await bot.stop();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[telegram-bot] error during shutdown", err);
    }
  };

  // Wire signals BEFORE start so an early SIGTERM still triggers bot.stop().
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  // eslint-disable-next-line no-console
  console.log("[telegram-bot] starting long-poll loop");

  // Auto-restart loop. If bot.start() rejects (network blip, Telegram 5xx),
  // log + alert and restart with capped backoff. Only stop on SIGTERM/SIGINT.
  let backoffMs = 1_000;
  let crashedOnce = false;
  while (true) {
    if (crashedOnce) {
      reportStatus({
        key: "telegram-bot:long-poll",
        state: "up",
        severity: "info",
        title: "Telegram bot recovered",
        message: "Long-poll loop resumed.",
      });
      crashedOnce = false;
      backoffMs = 1_000;
    }
    try {
      await bot.start();
      // bot.start() resolves after bot.stop() - clean exit.
      // eslint-disable-next-line no-console
      console.log("[telegram-bot] stopped cleanly");
      return;
    } catch (err) {
      const isDev = process.env.NODE_ENV !== "production";
      const msg = err instanceof Error ? err.message : String(err);
      const isConflict409 = /409.*Conflict|terminated by other getUpdates/i.test(msg);
      if (isDev && isConflict409) {
        // Another bot instance is polling the same token (prod bot, another
        // dev shell, etc). Restarting hits the same wall. Back off long and
        // stay quiet instead of spamming the giant grammy stack trace.
        // eslint-disable-next-line no-console
        console.warn(
          "[telegram-bot] 409 Conflict — TELEGRAM_BOT_TOKEN already polling elsewhere. Sleeping 60s. Use a separate dev bot token to run locally.",
        );
        await new Promise((r) => setTimeout(r, 60_000));
        continue;
      }
      // eslint-disable-next-line no-console
      console.error("[telegram-bot] bot.start() rejected, restarting", err);
      crashedOnce = true;
      reportStatus({
        key: "telegram-bot:long-poll",
        state: "down",
        severity: "warning",
        title: "Telegram bot long-poll crashed",
        message: `bot.start() rejected; restarting in ${backoffMs}ms.`,
        fields: [{ name: "error", value: describeError(err, 400) }],
      });
      await new Promise((r) => setTimeout(r, backoffMs));
      backoffMs = Math.min(backoffMs * 2, 60_000);
    }
  }
}

// Only auto-boot when this file is the entrypoint (not when imported by tests).
type NodeRequire = { main?: unknown };
const nodeRequire =
  typeof require !== "undefined"
    ? (require as unknown as NodeRequire)
    : undefined;
const isEntrypoint =
  typeof module !== "undefined" && nodeRequire?.main === module;

if (isEntrypoint) {
  installProcessGuards("telegram-bot");
  bootBot().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[telegram-bot] failed to boot", err);
    reportEvent({
      key: "telegram-bot:boot",
      severity: "critical",
      title: "Telegram bot boot failed",
      message:
        "bootBot() threw outside the long-poll restart loop. Process is alive but bot is offline.",
      fields: [{ name: "error", value: describeError(err, 600) }],
    });
    // Stay alive per ops policy.
  });
}

export { bootBot };
