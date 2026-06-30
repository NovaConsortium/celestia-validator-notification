import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChannelAdapter, ChannelRecord, ValidatorContext } from "@/types/channels";
import type { Severity, ValidatorEvent } from "@/types/events";
import {
  DEFAULT_TEMPLATES,
  DEFAULT_TITLE_TEMPLATES,
} from "./templates/defaults";
import { render, buildVars } from "./templates/render";

const DISCORD_COLORS: Record<Severity, number> = {
  info: 0x3498db,
  warning: 0xf39c12,
  critical: 0xe74c3c,
};

const TIMEOUT_MS = 10_000;

/**
 * Discord only renders thumbnail.url over http(s). Filter out anything
 * else (data: URIs, relative paths, empty strings) so the webhook
 * doesn't 400 on the whole embed.
 */
function safeImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

/**
 * Read the nova PNG once and cache the bytes. Used as the default
 * embed thumbnail when the validator has no logo. We attach the file
 * via multipart and reference it as `attachment://nova.png` so the
 * embed doesn't depend on PUBLIC_URL being publicly reachable.
 *
 * `undefined` = unread. `null` = read failed (file missing in this
 * runtime). On null we drop the thumbnail rather than throw.
 */
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
      throw new Error(`discord webhook ${res.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function postMultipart(
  url: string,
  payload: object,
  fileBytes: Buffer,
  filename: string,
): Promise<void> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const fd = new FormData();
    fd.append("payload_json", JSON.stringify(payload));
    fd.append(
      "files[0]",
      new Blob([new Uint8Array(fileBytes)], { type: "image/png" }),
      filename,
    );
    const res = await fetch(url, {
      method: "POST",
      body: fd,
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`discord webhook ${res.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export const adapter: ChannelAdapter = {
  type: "discord",
  send: async (
    channel: ChannelRecord,
    event: ValidatorEvent,
    validator: ValidatorContext,
  ): Promise<void> => {
    const url = channel.config.webhookUrl;
    if (!url) throw new Error("discord: missing webhookUrl");

    const bodyTmpl =
      channel.config.templates?.[event.type] ?? DEFAULT_TEMPLATES[event.type];
    const titleTmpl =
      channel.config.titleTemplates?.[event.type] ??
      DEFAULT_TITLE_TEMPLATES[event.type];
    const vars = buildVars(event, validator, {
      publicUrl: process.env.PUBLIC_URL ?? "",
    });
    const rendered = render(bodyTmpl, vars);
    const title = render(titleTmpl, vars).slice(0, 256);

    if (channel.config.rawTemplate) {
      await postJson(url, { content: rendered });
      return;
    }

    const color = DISCORD_COLORS[event.severity] ?? DISCORD_COLORS.info;

    // Prefer the validator's real logo (Celenium metadata) when available;
    // otherwise fall back to the bundled nova.png attachment.
    const validatorLogo = safeImageUrl(validator.logoUrl);
    let thumbnailUrl: string | undefined = validatorLogo;
    let novaAttachment: Buffer | null = null;
    if (!thumbnailUrl) {
      novaAttachment = await loadNovaBytes();
      if (novaAttachment) {
        thumbnailUrl = "attachment://nova.png";
      }
    }

    const payload = {
      embeds: [
        {
          title,
          description: rendered,
          color,
          timestamp: event.occurredAt.toISOString(),
          ...(thumbnailUrl ? { thumbnail: { url: thumbnailUrl } } : {}),
          footer: {
            text: `${validator.network} • validator ${vars.validator_id}`,
          },
        },
      ],
    };

    if (novaAttachment) {
      await postMultipart(url, payload, novaAttachment, "nova.png");
    } else {
      await postJson(url, payload);
    }
  },
};

export default adapter;
