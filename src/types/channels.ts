import type { EventType, Network, ValidatorEvent } from "./events";

export type ChannelType =
  | "discord"
  | "telegram"
  | "slack"
  | "pagerduty"
  | "email";

/**
 * Logical event groups the user picks routing for. Each maps to one or
 * more raw EventType values at dispatch time (see EVENT_GROUP in
 * src/channels/dispatcher.ts).
 *   slotSkip   → skip
 *   offline    → offline, recovered
 *   delegation → delegate, undelegate
 *   commission → commission_changed
 */
export type EventGroupKey = "slotSkip" | "offline" | "delegation" | "commission";

// Event groups surfaced in the UI / used as the default channel fan-out.
export const ALL_EVENT_GROUPS: readonly EventGroupKey[] = [
  "slotSkip",
  "offline",
  "delegation",
  "commission",
] as const;

/**
 * Per-channel-type blocklist of event groups. Currently empty — no channel
 * type restricts groups. Kept (with its helpers) so re-introducing a
 * restriction later is a one-line change.
 */
export const CHANNEL_DISALLOWED_GROUPS: Partial<
  Record<ChannelType, readonly EventGroupKey[]>
> = {};

export function isChannelGroupAllowed(
  type: ChannelType,
  group: EventGroupKey,
): boolean {
  return !CHANNEL_DISALLOWED_GROUPS[type]?.includes(group);
}

export function sanitizeChannelEvents(
  type: ChannelType,
  events: EventGroupKey[],
): EventGroupKey[] {
  const blocked = CHANNEL_DISALLOWED_GROUPS[type];
  if (!blocked || blocked.length === 0) return events;
  return events.filter((g) => !blocked.includes(g));
}

export interface ChannelConfig {
  // discord
  webhookUrl?: string;
  // telegram
  chatId?: string;
  // Display label for the paired Telegram chat ("@username" or full name).
  // Set by the bot during /start so the dashboard can confirm who paired.
  chatTitle?: string;
  // slack - also uses webhookUrl
  // pagerduty
  routingKey?: string;
  // sms / voice (Telnyx). Credentials come from server env only;
  // per-channel `from` overrides the default sender, `to` is the
  // verified recipient phone in E.164 (for sms/voice) or a lowercased
  // email address (for email).
  from?: string;
  to?: string;
  // common
  rawTemplate?: boolean;
  templates?: Partial<Record<EventType, string>>;
  // Discord embed title overrides per event type. Only Discord consumes
  // these today; other adapters ignore them. Default per-event title is
  // `{validator_name} — {event_label}`.
  titleTemplates?: Partial<Record<EventType, string>>;
  // Email subject line overrides per event type. Only the email adapter
  // consumes these; other adapters ignore them.
  subjectTemplates?: Partial<Record<EventType, string>>;
  // Short-lived HMAC token issued by /api/sms/verify/confirm or
  // /api/email/verify/confirm. Carried through the subscription
  // create/PATCH bodies for sms / voice / email channels; never persisted.
  verifiedToken?: string;
  // One-shot token returned by /api/telegram/pair (wallet path). Carried
  // in the subscription create body for unsaved telegram channels; the
  // backend resolves it to a chatId at create time and never persists.
  pairingToken?: string;
}

export interface ChannelRecord {
  id: string;
  type: ChannelType;
  config: ChannelConfig;
  enabled: boolean;
  /** Event groups this channel receives. Empty = receives nothing. */
  events: EventGroupKey[];
}

export interface ValidatorContext {
  id: bigint;
  network: Network;
  name?: string;
  authAddress: string;
  /** Validator logo URL (Celenium metadata). Used for Discord thumbnail. */
  logoUrl?: string;
}

export interface ChannelAdapter {
  type: ChannelType;
  send(
    channel: ChannelRecord,
    event: ValidatorEvent,
    validator: ValidatorContext,
  ): Promise<void>;
  resolve?(
    channel: ChannelRecord,
    event: ValidatorEvent,
    validator: ValidatorContext,
  ): Promise<void>;
}
