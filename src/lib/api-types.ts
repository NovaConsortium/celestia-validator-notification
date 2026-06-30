/**
 * Wave-2 contract surface between frontend-dev and api-dev.
 *
 * All API request/response shapes for /api/* routes live here so both
 * agents reference one definition. BigInt values are serialized as strings
 * on the wire - JSON can't carry BigInt natively and Next route params
 * arrive as strings anyway.
 *
 * Both runtime zod schemas (used by route handlers + frontend forms) and
 * static TypeScript interfaces (handy for typing fetch responses) are
 * exported. Keep them in sync if you add fields.
 */
import { z } from "zod";
import {
  ALL_EVENT_GROUPS,
  type ChannelType,
  type ChannelConfig,
  type EventGroupKey,
} from "@/types/channels";
import type { EventType, Network, Severity } from "@/types/events";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CHANNEL_TYPES = [
  "discord",
  "telegram",
  "slack",
  "pagerduty",
  "email",
] as const;

export const EVENT_TYPES = [
  "skip",
  "offline",
  "recovered",
  "delegate",
  "undelegate",
  "commission_changed",
] as const;

export const NETWORKS = ["mainnet", "testnet"] as const;

export const SEVERITIES = ["info", "warning", "critical"] as const;

export const EVENT_GROUPS = [
  "slotSkip",
  "offline",
  "delegation",
  "commission",
] as const;

export const EventGroupKeySchema = z.enum(EVENT_GROUPS);

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
  message?: string;
  details?: Record<string, unknown>;
}

const ValidatorIdSchema = z
  .string()
  .min(1)
  .regex(/^\d+$/u, "validatorId must be a base-10 integer string");

// ---------------------------------------------------------------------------
// Channel config
// ---------------------------------------------------------------------------

export const ChannelConfigSchema = z
  .object({
    webhookUrl: z.string().url().optional(),
    chatId: z.string().optional(),
    chatTitle: z.string().optional(),
    routingKey: z.string().min(20).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    rawTemplate: z.boolean().optional(),
    // partialRecord = subset of keys allowed; an exhaustive `record` would
    // demand every event type be present.
    templates: z
      .partialRecord(
        z.enum(EVENT_TYPES),
        z.string().max(500, "template must be 500 characters or fewer"),
      )
      .optional(),
    // Discord-only embed title overrides per event type. Other adapters
    // ignore them today.
    titleTemplates: z
      .partialRecord(
        z.enum(EVENT_TYPES),
        z.string().max(256, "title must be 256 characters or fewer"),
      )
      .optional(),
    // Email-only subject line overrides per event type. Other adapters
    // ignore them.
    subjectTemplates: z
      .partialRecord(
        z.enum(EVENT_TYPES),
        z.string().max(256, "subject must be 256 characters or fewer"),
      )
      .optional(),
    // Short-lived HMAC token proving the user verified ownership of the
    // phone number / email in `to`. Required for new sms / voice / email
    // channels. Stripped server-side before persisting (one-time use).
    verifiedToken: z.string().optional(),
    // One-shot token from /api/telegram/pair (wallet path). Stripped
    // server-side after the backend resolves it to a chatId at create
    // time. Never persisted.
    pairingToken: z.string().optional(),
  })
  .passthrough();

export const ChannelInputSchema = z.object({
  id: z.string().optional(), // present when editing an existing channel
  type: z.enum(CHANNEL_TYPES),
  config: ChannelConfigSchema,
  enabled: z.boolean().optional(),
  // Event groups this channel will receive. Defaults to all four
  // (preserves prior fan-out for clients that don't send the field).
  // Empty array allowed — the channel is kept but routed to nothing.
  events: z
    .array(EventGroupKeySchema)
    .default([...ALL_EVENT_GROUPS])
    .optional(),
});

export interface ChannelInput {
  id?: string;
  type: ChannelType;
  config: ChannelConfig;
  enabled?: boolean;
  events?: EventGroupKey[];
}

// Output channel: config is redacted server-side (secrets never leave).
export interface ChannelOutput {
  id: string;
  type: ChannelType;
  enabled: boolean;
  config: Record<string, unknown>;
  events: EventGroupKey[];
  paired?: boolean;
  lastErrorAt?: string | null;
  lastErrorMsg?: string | null;
}

// ---------------------------------------------------------------------------
// Alert config
// ---------------------------------------------------------------------------

export const AlertConfigSchema = z.object({
  slotSkip: z.boolean(),
  offline: z.boolean().optional(),
  offlineAfterN: z.number().int().min(2).max(50),
  // Delegation + commission-change alerts (sourced from Celenium block
  // messages). Opt-in like slotSkip. delegationMinTia filters out delegations
  // smaller than the given TIA amount.
  delegation: z.boolean().optional(),
  delegationMinTia: z.number().nonnegative().optional(),
  commission: z.boolean().optional(),
});

export type AlertConfig = z.infer<typeof AlertConfigSchema>;

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export const SubscriptionCreateSchema = z.object({
  validatorId: ValidatorIdSchema,
  network: z.enum(NETWORKS),
  alertConfig: AlertConfigSchema,
  customRpcUrl: z.string().url().optional(),
  customRpcRole: z.enum(["primary", "fallback"]).optional(),
  channels: z.array(ChannelInputSchema).min(1),
  hcaptchaToken: z.string(),
});

// Frontend-friendly TypeScript interface (not zod-inferred). Keeps
// `config: ChannelConfig` aligned with the locked type without the
// index-signature shenanigans that `passthrough()` adds.
export interface CreateSubscriptionRequest {
  validatorId: string;
  network: Network;
  alertConfig: AlertConfig;
  channels: ChannelInput[];
  customRpcUrl?: string;
  customRpcRole?: "primary" | "fallback";
  hcaptchaToken: string;
}

export interface CreateSubscriptionResponse {
  subscriptionId: string;
  walletAddress: string;
}

export const SubscriptionPatchSchema = z.object({
  alertConfig: AlertConfigSchema.partial().optional(),
  customRpcUrl: z.string().url().nullable().optional(),
  customRpcRole: z.enum(["primary", "fallback"]).nullable().optional(),
  channels: z.array(ChannelInputSchema).optional(),
});

export interface UpdateSubscriptionRequest {
  alertConfig?: Partial<AlertConfig>;
  customRpcUrl?: string | null;
  customRpcRole?: "primary" | "fallback" | null;
  channels?: ChannelInput[];
}

export interface SubscriptionResponse {
  id: string;
  validatorId: string;
  network: Network;
  alertConfig: AlertConfig;
  customRpcUrl?: string | null;
  customRpcRole?: "primary" | "fallback" | null;
  /** Lowercased Celestia (bech32) address that owns this subscription. */
  walletAddress: string;
  channels: ChannelOutput[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Auth (Celestia wallet / Keplr ADR-036)
// ---------------------------------------------------------------------------

export interface AuthNonceResponse {
  nonce: string;
}

export interface AuthVerifyRequest {
  /** Bech32 celestia1… address that signed. */
  address: string;
  /** The exact plaintext that was signed. */
  message: string;
  /** ADR-036 signature, base64 (from window.keplr.signArbitrary). */
  signature: string;
  /** secp256k1 public key, base64 (from the StdSignature pub_key.value). */
  pubKey: string;
}

export interface AuthVerifyResponse {
  address: string;
}

export interface AuthSessionResponse {
  address: string | null;
}

export interface MineValidatorInfo {
  name?: string;
  logo?: string;
}

export interface MineSubscriptionsResponse {
  subscriptions: SubscriptionResponse[];
  /**
   * Validator metadata keyed by `${network}:${validatorId}` so the client
   * can render a name + logo without an extra round-trip per subscription.
   */
  validators?: Record<string, MineValidatorInfo>;
}

export interface DeleteSubscriptionResponse {
  ok: true;
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export const ChannelTestSchema = z.object({
  channel: ChannelInputSchema,
  eventType: z.enum(EVENT_TYPES),
  validator: z
    .object({
      id: ValidatorIdSchema.optional(),
      network: z.enum(NETWORKS).optional(),
      name: z.string().optional(),
      authAddress: z.string().optional(),
    })
    .optional(),
});

export type ChannelTestRequest = z.infer<typeof ChannelTestSchema>;

export interface ChannelTestResponse {
  ok: boolean;
  error?: string;
}

export interface ChannelStatusResponse {
  id: string;
  type: ChannelType;
  paired: boolean;
  enabled: boolean;
  /** "@username" / display name for paired Telegram channels, if known. */
  chatTitle?: string;
  lastErrorAt?: string | null;
  lastErrorMsg?: string | null;
}

// ---------------------------------------------------------------------------
// Telegram pairing
// ---------------------------------------------------------------------------

export const TelegramPairRequestSchema = z.union([
  z.object({ channelId: z.string().min(1) }),
  z.object({ subscriptionId: z.string().min(1) }),
  z.object({}).strict(), // wallet-scoped: empty body, server uses session
]);

export type TelegramPairRequest = z.infer<typeof TelegramPairRequestSchema>;

export interface TelegramPairResponse {
  /** Present only for channel-bound and subscription-bound pairings. */
  channelId?: string;
  token: string;
  expiresAt: string;
  deepLink: string;
}

export interface TelegramPairingStatusResponse {
  paired: boolean;
  expired?: boolean;
  /** "@username" or display name of the user who confirmed in Telegram. */
  chatTitle?: string;
  /** Bot-side rejection reason (e.g. cross-validator chat collision). */
  error?: string;
}

// ---------------------------------------------------------------------------
// Dev: synthetic event
// ---------------------------------------------------------------------------

export const SyntheticEventSchema = z.object({
  validatorId: ValidatorIdSchema,
  network: z.enum(NETWORKS),
  type: z.enum(EVENT_TYPES),
  severity: z.enum(SEVERITIES).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type SyntheticEventRequest = z.infer<typeof SyntheticEventSchema>;

// ---------------------------------------------------------------------------
// Validator events (read-only)
// ---------------------------------------------------------------------------

export const ValidatorEventsQuerySchema = z.object({
  network: z.enum(NETWORKS).default("mainnet"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export interface ValidatorEventSummary {
  id: string;
  type: EventType;
  severity: Severity;
  occurredAt: string;
  blockNumber?: string | null;
  payload: Record<string, unknown>;
}

export interface ValidatorEventsResponse {
  events: ValidatorEventSummary[];
}

// ---------------------------------------------------------------------------
// Validator metadata pass-through (used by /api/validators/* if added)
// ---------------------------------------------------------------------------

export interface ValidatorMetadata {
  id: string;
  network: Network;
  authAddress: string;
  name?: string;
  stake?: string;
  successRate?: number;
  country?: string;
  status?: string;
  blsPubkey?: string;
  secpPubkey?: string;
  logo?: string;
}
