import type { ChannelAdapter, ChannelRecord, ValidatorContext } from "@/types/channels";
import type { ValidatorEvent } from "@/types/events";
import {
  DEFAULT_TEMPLATES,
  DEFAULT_TITLE_TEMPLATES,
} from "./templates/defaults";
import { render, buildVars } from "./templates/render";

const TIMEOUT_MS = 10_000;
// Telegram caption max for sendPhoto (4096 for sendMessage). If our
// composed text exceeds this we fall back to sendMessage so the alert
// isn't silently truncated.
const TELEGRAM_CAPTION_MAX = 1024;

function safeImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

function novaFallbackUrl(): string | undefined {
  const base = (process.env.PUBLIC_URL ?? "").replace(/\/+$/, "");
  if (!base) return undefined;
  if (!/^https?:\/\//i.test(base)) return undefined;
  return `${base}/nova.png`;
}

/**
 * Escape MarkdownV2 special characters per Telegram Bot API spec.
 * Apply to placeholder VALUES (operator-supplied template literals are not escaped).
 *
 * Kept exported for backward compatibility with tests. The adapter now
 * sends with `parse_mode: HTML` (see `escapeHtml`) because MarkdownV2
 * reserves so many ASCII chars (`(`, `)`, `.`, `!`, `-`, …) that any
 * template containing literal punctuation would fail to parse.
 */
export function escapeMdV2(s: string): string {
  return s.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, (m) => `\\${m}`);
}

/**
 * Escape the three HTML entities Telegram cares about. Apply to
 * placeholder VALUES; the template literal is left as-is so operators
 * can include `<b>`, `<i>`, `<a href="…">` if they want.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function postJson(url: string, body: unknown): Promise<void> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`telegram sendMessage ${res.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export const adapter: ChannelAdapter = {
  type: "telegram",
  send: async (
    channel: ChannelRecord,
    event: ValidatorEvent,
    validator: ValidatorContext,
  ): Promise<void> => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error("telegram: TELEGRAM_BOT_TOKEN env var is not set");
    }
    const chatId = channel.config.chatId;
    if (!chatId) throw new Error("telegram: missing chatId in channel config");

    const bodyTmpl =
      channel.config.templates?.[event.type] ?? DEFAULT_TEMPLATES[event.type];
    const titleTmpl =
      channel.config.titleTemplates?.[event.type] ??
      DEFAULT_TITLE_TEMPLATES[event.type];
    const rawVars = buildVars(event, validator, {
      publicUrl: process.env.PUBLIC_URL ?? "",
    });
    // Escape placeholder VALUES (HTML entities), not the template literal.
    const escapedVars: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawVars)) {
      escapedVars[k] = escapeHtml(v);
    }
    const renderedBody = render(bodyTmpl, escapedVars);
    const renderedTitle = render(titleTmpl, escapedVars);

    if (channel.config.rawTemplate) {
      await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: chatId,
        text: renderedBody,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
      return;
    }

    const dashboardLink = escapedVars.dashboard_url
      ? `\n\n<a href="${escapedVars.dashboard_url}">Open dashboard</a>`
      : "";
    const composed = `<b>${renderedTitle}</b>\n\n${renderedBody}${dashboardLink}`;

    const photoUrl =
      safeImageUrl(validator.logoUrl) ?? novaFallbackUrl();

    if (photoUrl && composed.length <= TELEGRAM_CAPTION_MAX) {
      await postJson(`https://api.telegram.org/bot${token}/sendPhoto`, {
        chat_id: chatId,
        photo: photoUrl,
        caption: composed,
        parse_mode: "HTML",
      });
      return;
    }

    await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: composed,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  },
};

export default adapter;
