import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Resend } from "resend";
import type {
  ChannelAdapter,
  ChannelRecord,
  ValidatorContext,
} from "@/types/channels";
import type { Severity, ValidatorEvent } from "@/types/events";
import {
  DEFAULT_TEMPLATES,
  DEFAULT_SUBJECT_TEMPLATES,
} from "./templates/defaults";
import { render, buildVars } from "./templates/render";

const DEFAULT_FROM = "Nova Consortium Alerts <alerts@novaconsortium.xyz>";
const NOVA_CID = "nova-logo";

/**
 * Read public/nova.png once and cache the bytes. Embedded as an
 * inline attachment with Content-ID so the footer logo renders without
 * depending on PUBLIC_URL being publicly reachable from mail clients
 * (the dev / staging setups have non-public URLs).
 *
 * `undefined` = unread. `null` = read failed in this runtime — we drop
 * the footer logo rather than ship a broken <img>.
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

/** Hex colour per severity, used for the email accent badge. */
const SEVERITY_COLORS: Record<Severity, { bg: string; fg: string; label: string }> = {
  info: { bg: "#e6f0fa", fg: "#1d4ed8", label: "Info" },
  warning: { bg: "#fdecd3", fg: "#b45309", label: "Warning" },
  critical: { bg: "#fde2e2", fg: "#b91c1c", label: "Critical" },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

let cachedClient: Resend | null = null;
function getClient(): Resend {
  if (cachedClient) return cachedClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("email: RESEND_API_KEY is not set");
  cachedClient = new Resend(key);
  return cachedClient;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function safeHttpUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//iu.test(url) ? url : undefined;
}

interface BuildHtmlOptions {
  bodyPlain: string;
  subject: string;
  severity: Severity;
  validatorName: string;
  validatorLogo: string | undefined;
  publicUrl: string;
  manageUrl: string;
  unsubscribeUrl: string;
  explorerUrl: string;
  network: string;
  /** True when the Nova logo is being shipped as an inline attachment. */
  novaEmbedded: boolean;
}

function buildHtml(opts: BuildHtmlOptions): string {
  const sev = SEVERITY_COLORS[opts.severity] ?? SEVERITY_COLORS.info;
  const logo = safeHttpUrl(opts.validatorLogo);
  const novaLogo = opts.novaEmbedded ? `cid:${NOVA_CID}` : "";
  const bodyHtml = escapeHtml(opts.bodyPlain).replace(/\n/gu, "<br />");

  // Inline styles — many email clients strip <style> blocks.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(opts.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:'Neue Haas Grotesk Display Pro','Helvetica Neue',Helvetica,Arial,sans-serif;color:#111;">
<div style="display:none;max-height:0;overflow:hidden;color:transparent;">
${escapeHtml(opts.bodyPlain.slice(0, 140))}
</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f5f7;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
<tr><td style="padding:20px 24px;border-bottom:1px solid #f0f0f0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
<tr>
<td style="vertical-align:middle;">
${logo ? `<img src="${escapeHtml(logo)}" alt="" width="40" height="40" style="border-radius:8px;display:block;border:0;" />` : ""}
</td>
<td style="vertical-align:middle;padding-left:${logo ? "12px" : "0"};">
<div style="font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(opts.network)} validator</div>
<div style="font-size:18px;font-weight:600;color:#111;">${escapeHtml(opts.validatorName)}</div>
</td>
<td align="right" style="vertical-align:middle;">
<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${sev.bg};color:${sev.fg};font-size:12px;font-weight:600;">${sev.label}</span>
</td>
</tr></table>
</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55;color:#1f2937;">
${bodyHtml}
</td></tr>
<tr><td style="padding:20px 24px;border-top:1px solid #f0f0f0;background:#fafafa;font-size:12px;color:#6b7280;line-height:1.5;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
<tr>
<td style="vertical-align:middle;">
${novaLogo ? `<img src="${novaLogo}" alt="" width="20" height="20" style="display:inline-block;vertical-align:middle;border-radius:4px;border:0;" />` : ""}
<span style="vertical-align:middle;${novaLogo ? "margin-left:6px;" : ""}font-weight:700;color:#374151;">Nova Consortium</span>
</td>
<td align="right" style="vertical-align:middle;">
<a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>
&nbsp;·&nbsp;
<a href="${escapeHtml(opts.manageUrl)}" style="color:#6b7280;text-decoration:underline;">Manage</a>
</td>
</tr></table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export const adapter: ChannelAdapter = {
  type: "email",
  send: async (
    channel: ChannelRecord,
    event: ValidatorEvent,
    validator: ValidatorContext,
  ): Promise<void> => {
    const to = channel.config.to;
    if (!to || typeof to !== "string" || !EMAIL_RE.test(to)) {
      throw new Error("email: missing or invalid recipient address");
    }

    const publicUrl = process.env.PUBLIC_URL?.replace(/\/$/u, "") ?? "";
    const from = process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;
    const replyTo = process.env.EMAIL_REPLY_TO?.trim() || from;

    const bodyTmpl =
      channel.config.templates?.[event.type] ?? DEFAULT_TEMPLATES[event.type];
    const subjectTmpl =
      channel.config.subjectTemplates?.[event.type] ??
      DEFAULT_SUBJECT_TEMPLATES[event.type];

    const vars = buildVars(event, validator, { publicUrl });
    const bodyPlain = render(bodyTmpl, vars);
    const subject = render(subjectTmpl, vars).slice(0, 256);

    // For ephemeral test sends, channel.id === "test"; the disable link
    // can't be acted on. Point unsubscribe at /my-alerts in that case.
    const unsubscribeUrl =
      channel.id && channel.id !== "test" && publicUrl
        ? `${publicUrl}/api/channels/${encodeURIComponent(channel.id)}/disable`
        : `${publicUrl}/my-alerts`;
    const manageUrl = `${publicUrl}/my-alerts`;

    // Inline the Nova logo as a Content-ID attachment so the footer
    // renders without depending on PUBLIC_URL being reachable from the
    // mail client. Drop the logo if the bytes can't be read.
    const novaBytes = await loadNovaBytes();

    const html = buildHtml({
      bodyPlain,
      subject,
      severity: event.severity,
      validatorName: vars.validator_name,
      validatorLogo: validator.logoUrl,
      publicUrl,
      manageUrl,
      unsubscribeUrl,
      explorerUrl: vars.explorer_url,
      network: vars.network,
      novaEmbedded: novaBytes !== null,
    });

    const replyToAddr = replyTo.match(/<([^>]+)>/u)?.[1] ?? replyTo;
    const client = getClient();
    // List-Unsubscribe (RFC 2369): keep the GET link + mailto so mail
    // clients can surface a manual unsubscribe. We deliberately omit
    // `List-Unsubscribe-Post` because the disable route requires a wallet
    // session — it cannot honour an unauthenticated one-click POST (RFC
    // 8058). Adding the Post header without a working endpoint would
    // hurt deliverability rather than help.
    const { data, error } = await client.emails.send({
      from,
      to: [to],
      subject,
      html,
      replyTo,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:${replyToAddr}?subject=unsubscribe>`,
      },
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
    // eslint-disable-next-line no-console
    console.log(
      `[email.send] to=${to} subject="${subject}" resend_id=${data?.id ?? "none"} error=${error ? `${error.name}:${error.message}` : "none"}`,
    );
    if (error) {
      throw new Error(
        `resend ${error.name ?? "error"}: ${error.message ?? "unknown"}`,
      );
    }

    // Test fires only (channel.id === "test"): poll Resend for the
    // terminal event so the UI's green-check actually reflects delivery
    // intent. Production dispatches don't poll — the dispatcher already
    // persists failure markers via lastErrorMsg, and we don't want a
    // per-event extra GET on every real alert.
    if (channel.id === "test" && data?.id) {
      await pollDelivery(client, data.id, to);
    }
  },
};

/**
 * Poll the Resend email by id until last_event reaches a terminal state
 * or the budget expires. Throws on `bounced` / `failed` / `complained`
 * / `suppressed` / `canceled` so the test endpoint surfaces the
 * failure to the user instead of a misleading "Test sent".
 *
 * Budget: 8 polls * 750ms = up to 6s. If still queued/scheduled at
 * exhaustion, accept it as success — Resend may be backed up and we
 * don't want to misreport a likely-delivered send as failed.
 */
async function pollDelivery(
  client: Resend,
  id: string,
  to: string,
): Promise<void> {
  const MAX_POLLS = 8;
  const INTERVAL_MS = 750;
  const FAILURE_EVENTS = new Set([
    "bounced",
    "failed",
    "complained",
    "suppressed",
    "canceled",
  ]);
  const ACCEPTED_EVENTS = new Set([
    "delivered",
    "opened",
    "clicked",
    "sent",
    "delivery_delayed",
  ]);

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise<void>((res) => setTimeout(res, INTERVAL_MS));
    let last: string | undefined;
    try {
      const { data: row, error: getErr } = await client.emails.get(id);
      if (getErr) {
        // eslint-disable-next-line no-console
        console.warn(
          `[email.poll] id=${id} get_error=${getErr.name}:${getErr.message}`,
        );
        continue;
      }
      last = row?.last_event;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[email.poll] id=${id} threw=${(err as Error).message}`);
      continue;
    }
    if (!last) continue;
    // eslint-disable-next-line no-console
    console.log(`[email.poll] id=${id} to=${to} last_event=${last}`);
    if (FAILURE_EVENTS.has(last)) {
      throw new Error(`resend delivery ${last}`);
    }
    if (ACCEPTED_EVENTS.has(last)) {
      return;
    }
    // still queued / scheduled — keep polling.
  }
  // Budget exhausted. Don't throw — Resend may just be slow.
  // eslint-disable-next-line no-console
  console.log(`[email.poll] id=${id} to=${to} budget_exhausted`);
}

export default adapter;
