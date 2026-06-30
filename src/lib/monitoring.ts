/**
 * Private ops alerting via Discord webhook.
 *
 * Posts to MONITORING_DISCORD_WEBHOOK_URL. URL is never logged, never echoed,
 * never exposed to API responses. Missing env = silent no-op (self-hosters
 * may not configure it).
 *
 * State machine per `key`:
 *   - "down" → "up" transition: always sends recovery (info)
 *   - "up"   → "down" transition: always sends incident
 *   - same state: throttled to 1 alert / THROTTLE_MS
 *
 * Throttle is in-memory; resets on process restart. Acceptable for MVP.
 */
import type { Severity } from "@/types/events";

const THROTTLE_MS = 5 * 60_000;
const POST_TIMEOUT_MS = 5_000;

const COLORS: Record<Severity, number> = {
  info: 0x2ecc71,
  warning: 0xf39c12,
  critical: 0xe74c3c,
};

type State = "down" | "up";

interface Entry {
  state: State;
  lastSentAt: number;
}

const stateMap = new Map<string, Entry>();

function webhookUrl(): string | null {
  const u = process.env.MONITORING_DISCORD_WEBHOOK_URL;
  if (!u || u.trim().length === 0) return null;
  return u;
}

function processName(): string {
  return process.env.MONITORING_PROCESS_NAME ?? "celestia-vn";
}

/**
 * Comma-separated list of Discord user IDs to mention on warning/critical
 * alerts. Recovery (info) alerts do not ping. Empty/missing = no mention.
 */
function mentionUserIds(): string[] {
  const raw = process.env.MONITORING_DISCORD_USER_IDS;
  if (!raw || raw.trim().length === 0) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{5,30}$/.test(s));
}

async function postEmbed(
  url: string,
  severity: Severity,
  title: string,
  description: string,
  fields?: Array<{ name: string; value: string }>,
): Promise<void> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), POST_TIMEOUT_MS);
  try {
    const ids = severity === "info" ? [] : mentionUserIds();
    const content =
      ids.length > 0 ? ids.map((id) => `<@${id}>`).join(" ") : undefined;
    const body: Record<string, unknown> = {
      embeds: [
        {
          title,
          description: description.slice(0, 4000),
          color: COLORS[severity],
          timestamp: new Date().toISOString(),
          footer: { text: `${processName()} • ${severity}` },
          fields: (fields ?? []).slice(0, 10).map((f) => ({
            name: f.name.slice(0, 256),
            value: f.value.slice(0, 1024),
            inline: true,
          })),
        },
      ],
    };
    if (content !== undefined) {
      body.content = content;
      // Restrict allowed mentions to the configured user IDs only - prevents
      // accidental @everyone/@here pings if a title or description ever
      // contains those tokens.
      body.allowed_mentions = { parse: [], users: ids };
    }
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    }).catch(() => {
      /* swallow - monitoring must never throw into caller */
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Report an issue. Caller categorizes via `state`:
 *   state="down"   → fault detected (or persisting)
 *   state="up"     → recovery / nominal
 *
 * Transitions always alert. Same-state hits throttled.
 *
 * `key` MUST uniquely identify the resource (e.g. `rpc:${url}`,
 * `sse:${network}`). Generic keys cause cross-resource muting.
 *
 * Never throws. Safe to call from any code path.
 */
export function reportStatus(args: {
  key: string;
  state: State;
  severity: Severity;
  title: string;
  message: string;
  fields?: Array<{ name: string; value: string }>;
}): void {
  try {
    const url = webhookUrl();
    if (!url) return;

    const prev = stateMap.get(args.key);
    const now = Date.now();
    const transitioned = prev?.state !== args.state;
    const throttled =
      !transitioned && prev != null && now - prev.lastSentAt < THROTTLE_MS;

    stateMap.set(args.key, { state: args.state, lastSentAt: now });

    if (throttled) return;

    const sev =
      args.state === "up" && args.severity !== "info" ? "info" : args.severity;
    void postEmbed(url, sev, args.title, args.message, args.fields);
  } catch {
    /* monitoring must never throw */
  }
}

/**
 * One-shot alert (no state machine). Use for events that aren't
 * recoverable transitions: uncaught exceptions, boot failures, etc.
 *
 * Throttled to 1/THROTTLE_MS per `key`.
 */
export function reportEvent(args: {
  key: string;
  severity: Severity;
  title: string;
  message: string;
  fields?: Array<{ name: string; value: string }>;
}): void {
  try {
    const url = webhookUrl();
    if (!url) return;

    const prev = stateMap.get(args.key);
    const now = Date.now();
    if (prev && now - prev.lastSentAt < THROTTLE_MS) return;

    stateMap.set(args.key, { state: "down", lastSentAt: now });
    void postEmbed(url, args.severity, args.title, args.message, args.fields);
  } catch {
    /* monitoring must never throw */
  }
}

/** Truncated stringifier for unknown error values. */
export function describeError(err: unknown, max = 800): string {
  if (err == null) return "(no error)";
  if (err instanceof Error) {
    const s = err.stack ?? `${err.name}: ${err.message}`;
    return s.slice(0, max);
  }
  try {
    return String(err).slice(0, max);
  } catch {
    return "(unstringifiable error)";
  }
}

/** Install process-level safety nets. Logs + alerts; does NOT exit. */
export function installProcessGuards(component: string): void {
  process.on("unhandledRejection", (reason: unknown) => {
    // eslint-disable-next-line no-console
    console.error(`[${component}] unhandledRejection`, reason);
    reportEvent({
      key: `${component}:unhandledRejection`,
      severity: "critical",
      title: `${component}: unhandled promise rejection`,
      message: describeError(reason),
    });
  });
  process.on("uncaughtException", (err: Error) => {
    // eslint-disable-next-line no-console
    console.error(`[${component}] uncaughtException`, err);
    reportEvent({
      key: `${component}:uncaughtException`,
      severity: "critical",
      title: `${component}: uncaught exception`,
      message: describeError(err),
    });
  });
}

// Test helpers (not part of public API).
export function _resetMonitoringForTest(): void {
  stateMap.clear();
}
