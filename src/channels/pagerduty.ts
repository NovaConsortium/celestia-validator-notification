import type { ChannelAdapter, ChannelRecord, ValidatorContext } from "@/types/channels";
import type { Severity, ValidatorEvent } from "@/types/events";
import { DEFAULT_TEMPLATES } from "./templates/defaults";
import { render, buildVars } from "./templates/render";

const PD_URL = "https://events.pagerduty.com/v2/enqueue";
const TIMEOUT_MS = 10_000;

function pdSeverity(s: Severity): "critical" | "warning" | "info" {
  if (s === "critical") return "critical";
  if (s === "warning") return "warning";
  return "info";
}

function dedupKeyFor(event: ValidatorEvent, validator: ValidatorContext): string {
  if (event.dedupKey) return event.dedupKey;
  return `${validator.id.toString()}:${event.type}`;
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
      throw new Error(`pagerduty ${res.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function buildPayload(
  channel: ChannelRecord,
  event: ValidatorEvent,
  validator: ValidatorContext,
): { rendered: string } {
  const tmpl = channel.config.templates?.[event.type] ?? DEFAULT_TEMPLATES[event.type];
  const vars = buildVars(event, validator, {
    publicUrl: process.env.PUBLIC_URL ?? "",
  });
  return { rendered: render(tmpl, vars) };
}

export const adapter: ChannelAdapter = {
  type: "pagerduty",
  send: async (
    channel: ChannelRecord,
    event: ValidatorEvent,
    validator: ValidatorContext,
  ): Promise<void> => {
    const routingKey = channel.config.routingKey;
    if (!routingKey) throw new Error("pagerduty: missing routingKey");

    // Map "recovered" event automatically to resolve.
    if (event.type === "recovered") {
      await adapter.resolve!(channel, event, validator);
      return;
    }

    const { rendered } = buildPayload(channel, event, validator);
    await postJson(PD_URL, {
      routing_key: routingKey,
      event_action: "trigger",
      dedup_key: dedupKeyFor(event, validator),
      payload: {
        summary: rendered,
        severity: pdSeverity(event.severity),
        source: validator.name ?? `validator-${validator.id.toString()}`,
        custom_details: event.payload,
      },
    });
  },
  resolve: async (
    channel: ChannelRecord,
    event: ValidatorEvent,
    validator: ValidatorContext,
  ): Promise<void> => {
    const routingKey = channel.config.routingKey;
    if (!routingKey) throw new Error("pagerduty: missing routingKey");

    const { rendered } = buildPayload(channel, event, validator);
    await postJson(PD_URL, {
      routing_key: routingKey,
      event_action: "resolve",
      dedup_key: dedupKeyFor(event, validator),
      payload: {
        summary: rendered,
        severity: pdSeverity(event.severity),
        source: validator.name ?? `validator-${validator.id.toString()}`,
        custom_details: event.payload,
      },
    });
  },
};

export default adapter;
