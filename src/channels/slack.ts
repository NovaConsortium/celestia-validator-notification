import type { ChannelAdapter, ChannelRecord, ValidatorContext } from "@/types/channels";
import type { Severity, ValidatorEvent } from "@/types/events";
import {
  DEFAULT_TEMPLATES,
  DEFAULT_TITLE_TEMPLATES,
} from "./templates/defaults";
import { render, buildVars } from "./templates/render";

const TIMEOUT_MS = 10_000;

const SLACK_COLORS: Record<Severity, string> = {
  info: "#3498db",
  warning: "#f39c12",
  critical: "#e74c3c",
};

const SLACK_HEADER_MAX = 150;

/**
 * Slack `image_url` requires absolute http(s). Filter out anything else
 * (data URIs, relative paths, empty strings) so the section doesn't get
 * rejected with `invalid_blocks`.
 */
function safeImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

/** Nova fallback thumbnail when the validator has no logo. */
function novaFallbackUrl(): string | undefined {
  const base = (process.env.PUBLIC_URL ?? "").replace(/\/+$/, "");
  if (!base) return undefined;
  if (!/^https?:\/\//i.test(base)) return undefined;
  return `${base}/nova.png`;
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
      throw new Error(`slack webhook ${res.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export const adapter: ChannelAdapter = {
  type: "slack",
  send: async (
    channel: ChannelRecord,
    event: ValidatorEvent,
    validator: ValidatorContext,
  ): Promise<void> => {
    const url = channel.config.webhookUrl;
    if (!url) throw new Error("slack: missing webhookUrl");

    const bodyTmpl =
      channel.config.templates?.[event.type] ?? DEFAULT_TEMPLATES[event.type];
    const titleTmpl =
      channel.config.titleTemplates?.[event.type] ??
      DEFAULT_TITLE_TEMPLATES[event.type];
    const vars = buildVars(event, validator, {
      publicUrl: process.env.PUBLIC_URL ?? "",
    });
    const rendered = render(bodyTmpl, vars);
    const title = render(titleTmpl, vars).slice(0, SLACK_HEADER_MAX);

    if (channel.config.rawTemplate) {
      await postJson(url, { text: rendered });
      return;
    }

    const color = SLACK_COLORS[event.severity] ?? SLACK_COLORS.info;
    const thumbnailUrl = safeImageUrl(validator.logoUrl) ?? novaFallbackUrl();

    const sectionBlock: Record<string, unknown> = {
      type: "section",
      text: { type: "mrkdwn", text: rendered },
    };
    if (thumbnailUrl) {
      sectionBlock.accessory = {
        type: "image",
        image_url: thumbnailUrl,
        alt_text: validator.name ?? "Validator logo",
      };
    }

    const dashboardLink = vars.dashboard_url
      ? ` • <${vars.dashboard_url}|Open dashboard>`
      : "";

    const blocks: unknown[] = [
      {
        type: "header",
        text: { type: "plain_text", text: title },
      },
      sectionBlock,
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `${validator.network} • validator ${vars.validator_id}${dashboardLink}`,
          },
        ],
      },
    ];

    // Wrap in attachments[] so Slack renders the severity color stripe
    // along the left edge. The top-level `text` is the fallback shown in
    // notifications + screen-readers when blocks aren't rendered.
    await postJson(url, {
      text: title,
      attachments: [{ color, blocks }],
    });
  },
};

export default adapter;
