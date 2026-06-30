import { NextResponse } from "next/server";
import {
  ALL_EVENT_GROUPS,
  type ChannelConfig,
  type ChannelType,
  type EventGroupKey,
} from "@/types/channels";
import type { EventType } from "@/types/events";
import type { Channel as PrismaChannel, Subscription as PrismaSub } from "@prisma/client";
import { validateTemplate } from "@/channels/templates/render";
import { verifyEmailVerifiedToken } from "./verified-token";
import type { ChannelInput, ChannelOutput, SubscriptionResponse } from "./api-types";

export type EmailChannelVerificationFailure =
  | { channelIndex: number; reason: "missing_email" }
  | { channelIndex: number; reason: "missing_token" }
  | { channelIndex: number; reason: "expired_token" }
  | { channelIndex: number; reason: "invalid_token" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/**
 * Validate email-OTP verifiedTokens for any email channels. Pass
 * `priorEmailById` when patching: if a channel `id` exists with the
 * same email address, no token is required (re-using a prior
 * verification on an unchanged record).
 */
export function verifyEmailChannels(
  channels: ChannelInput[],
  priorEmailById?: Map<string, string | undefined>,
): EmailChannelVerificationFailure | null {
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    if (ch.type !== "email") continue;
    const email = ch.config.to?.trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      return { channelIndex: i, reason: "missing_email" };
    }

    if (ch.id && priorEmailById) {
      const prior = priorEmailById.get(ch.id);
      if (prior !== undefined && prior === email) continue;
    }

    const token = ch.config.verifiedToken;
    if (!token || typeof token !== "string") {
      return { channelIndex: i, reason: "missing_token" };
    }
    const result = verifyEmailVerifiedToken(token, email);
    if (!result.valid) {
      return {
        channelIndex: i,
        reason: result.expired ? "expired_token" : "invalid_token",
      };
    }
  }
  return null;
}

/**
 * Remove one-shot ephemeral tokens (`verifiedToken` from phone OTP,
 * `pairingToken` from Telegram /start) from each channel config. Both
 * are single-use proofs the user just completed a round-trip - they
 * must never be persisted (`redactChannelConfig` only strips a known
 * set of keys).
 */
export function stripVerifiedTokens(channels: ChannelInput[]): ChannelInput[] {
  return channels.map((ch) => {
    const hasVerified = "verifiedToken" in ch.config;
    const hasPairing = "pairingToken" in ch.config;
    if (!hasVerified && !hasPairing) return ch;
    const { verifiedToken: _v, pairingToken: _p, ...rest } = ch.config;
    return { ...ch, config: rest };
  });
}

/**
 * Build a normalized destination key for a channel. Two channels share a
 * key iff they would deliver to the same place - Telegram chat id,
 * webhook URL, PagerDuty routing key, or phone number.
 *
 * Returns null when the channel doesn't carry a usable destination yet
 * (e.g. unpaired Telegram, blank webhook). Such channels are skipped by
 * the duplicate check - they fail other validators first.
 */
export function channelDestKey(
  type: ChannelType,
  cfg: ChannelConfig,
): string | null {
  switch (type) {
    case "telegram":
      return cfg.chatId ? `telegram:${cfg.chatId}` : null;
    case "discord":
    case "slack": {
      const w = cfg.webhookUrl?.trim();
      return w ? `${type}:${w}` : null;
    }
    case "pagerduty": {
      const k = cfg.routingKey?.trim();
      return k ? `pagerduty:${k}` : null;
    }
    case "email": {
      const e = cfg.to?.trim().toLowerCase() ?? "";
      return e.length > 0 ? `email:${e}` : null;
    }
    default:
      return null;
  }
}

/**
 * Compose the (validatorNetKey, destKey) pair that populates the partial
 * unique index on Channel. Callers should pass the result through to
 * every `prisma.channel.create` / `prisma.channel.update` payload so
 * the DB-level duplicate constraint catches the residual TOCTOU between
 * the application-level findDuplicateChannel check and the actual
 * insert.
 *
 * destKey is null when the channel has no resolvable destination yet
 * (e.g. an unpaired Telegram row pre-/start). The partial unique index
 * is defined `WHERE destKey IS NOT NULL` so NULL rows do not collide.
 */
export function buildChannelKeys(
  type: ChannelType,
  config: ChannelConfig,
  validatorId: bigint,
  network: string,
): { destKey: string | null; validatorNetKey: string } {
  return {
    destKey: channelDestKey(type, config),
    validatorNetKey: `${network}:${validatorId.toString()}`,
  };
}

/** Human-readable label for a duplicate-channel error response. */
export function describeChannelDest(
  type: ChannelType,
  cfg: ChannelConfig,
): string {
  switch (type) {
    case "telegram":
      return "this Telegram chat";
    case "discord":
      return "this Discord webhook";
    case "slack":
      return "this Slack webhook";
    case "pagerduty":
      return "this PagerDuty routing key";
    case "email":
      return "this email address";
  }
}

export interface DuplicateChannelInfo {
  channelIndex: number;
  type: ChannelType;
  destination: string;
}

/**
 * Collapse every subscription owned by `walletAddress` for the given
 * (validator, network) pair into a single canonical sub - the one whose
 * id is `canonicalId`. Channels whose type already exists on the
 * canonical sub are deleted (one-channel-per-type rule); the rest are
 * re-parented. Sibling subs are then deleted.
 *
 * Must run inside a Prisma transaction. Returns the number of sibling
 * subs that were merged away (0 means nothing to do).
 */
export async function consolidateSiblingSubscriptions(
  tx: {
    subscription: {
      findMany: (args: {
        where: { walletAddress: string; validatorId: bigint; network: string };
        include: { channels: true };
        orderBy: { createdAt: "asc" };
      }) => Promise<
        {
          id: string;
          channels: { id: string; type: string }[];
        }[]
      >;
      deleteMany: (args: { where: { id: { in: string[] } } }) => Promise<unknown>;
    };
    channel: {
      deleteMany: (args: { where: { id: { in: string[] } } }) => Promise<unknown>;
      updateMany: (args: {
        where: { id: { in: string[] } };
        data: { subscriptionId: string };
      }) => Promise<unknown>;
    };
    telegramPairing: {
      deleteMany: (args: { where: { channelId: { in: string[] } } }) => Promise<unknown>;
    };
  },
  walletAddress: string,
  validatorId: bigint,
  network: string,
  canonicalId: string,
): Promise<number> {
  const all = await tx.subscription.findMany({
    where: { walletAddress, validatorId, network },
    include: { channels: true },
    orderBy: { createdAt: "asc" },
  });
  const canonical = all.find((s) => s.id === canonicalId);
  if (!canonical) return 0;
  const siblings = all.filter((s) => s.id !== canonicalId);
  if (siblings.length === 0) return 0;

  const canonicalTypes = new Set<ChannelType>(
    canonical.channels.map((c) => c.type as ChannelType),
  );
  const moveIds: string[] = [];
  const dropIds: string[] = [];
  for (const sib of siblings) {
    for (const ch of sib.channels) {
      const t = ch.type as ChannelType;
      if (canonicalTypes.has(t)) {
        dropIds.push(ch.id);
      } else {
        moveIds.push(ch.id);
        canonicalTypes.add(t);
      }
    }
  }
  if (dropIds.length > 0) {
    await tx.telegramPairing.deleteMany({ where: { channelId: { in: dropIds } } });
    await tx.channel.deleteMany({ where: { id: { in: dropIds } } });
  }
  if (moveIds.length > 0) {
    await tx.channel.updateMany({
      where: { id: { in: moveIds } },
      data: { subscriptionId: canonicalId },
    });
  }
  await tx.subscription.deleteMany({
    where: { id: { in: siblings.map((s) => s.id) } },
  });
  return siblings.length;
}

/**
 * One-channel-per-type rule: a subscription may have at most one channel
 * of each type (one Discord, one Telegram, etc). Returns the first
 * offending type (and the second occurrence's index) or null.
 *
 * `existingTypes` lets the caller add types already on the subscription
 * (e.g. when merging during POST or patching).
 */
export function findDuplicateChannelType(
  channels: ChannelInput[],
  existingTypes?: ReadonlySet<ChannelType>,
): { channelIndex: number; type: ChannelType } | null {
  const seen = new Set<ChannelType>(existingTypes ?? []);
  for (let i = 0; i < channels.length; i++) {
    const t = channels[i].type;
    if (seen.has(t)) return { channelIndex: i, type: t };
    seen.add(t);
  }
  return null;
}

/**
 * Find the first incoming channel whose destination already routes to a
 * subscription on the same (validator, network). Cross-wallet - the
 * destination identifies the duplicate. Channels in `ownChannelIds` are
 * exempt (used by PATCH so a subscription doesn't conflict with itself).
 *
 * Pass a Prisma `tx` from inside the create/update transaction so the
 * read sees the same snapshot as the subsequent insert.
 */
export async function findDuplicateChannel(
  tx: {
    channel: {
      findMany: (args: {
        where: { subscription: { validatorId: bigint; network: string } };
        select: {
          id: true;
          type: true;
          config: true;
          subscriptionId: true;
        };
      }) => Promise<
        { id: string; type: string; config: unknown; subscriptionId: string }[]
      >;
    };
  },
  validatorId: bigint,
  network: string,
  channels: ChannelInput[],
  ownChannelIds?: ReadonlySet<string>,
): Promise<DuplicateChannelInfo | null> {
  const existing = await tx.channel.findMany({
    where: { subscription: { validatorId, network } },
    select: { id: true, type: true, config: true, subscriptionId: true },
  });

  const existingByKey = new Map<string, string>();
  for (const c of existing) {
    if (ownChannelIds?.has(c.id)) continue;
    const cfg = (c.config ?? {}) as ChannelConfig;
    const k = channelDestKey(c.type as ChannelType, cfg);
    if (k) existingByKey.set(k, c.id);
  }

  const seenIncoming = new Set<string>();
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const k = channelDestKey(ch.type, ch.config);
    if (!k) continue;
    if (existingByKey.has(k) || seenIncoming.has(k)) {
      return {
        channelIndex: i,
        type: ch.type,
        destination: describeChannelDest(ch.type, ch.config),
      };
    }
    seenIncoming.add(k);
  }
  return null;
}

/**
 * Internal helpers shared by /api/* route handlers. Not part of the
 * frontend contract - keep that in api-types.ts.
 */

/** Field names that should never appear in API responses. Replace with sentinel. */
const REDACT_FIELDS = new Set<string>([
  "webhookUrl",
  "routingKey",
]);

/**
 * Produce a public-safe view of a channel config. Secrets are removed
 * and replaced with a `<field>Set: true` boolean so the UI can show
 * "credentials saved" without leaking the value.
 */
export function redactChannelConfig(config: ChannelConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (REDACT_FIELDS.has(k)) {
      if (v !== undefined && v !== null && v !== "") {
        out[`${k}Set`] = true;
      }
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** Serialize a Prisma Channel row for API output. */
export function serializeChannel(c: PrismaChannel): ChannelOutput {
  const cfg = (c.config as ChannelConfig) ?? {};
  return {
    id: c.id,
    type: c.type as ChannelType,
    enabled: c.enabled,
    config: redactChannelConfig(cfg),
    events: parseChannelEvents((c as { events?: unknown }).events),
    paired: c.type === "telegram" ? Boolean(cfg.chatId) : undefined,
    lastErrorAt: c.lastErrorAt ? c.lastErrorAt.toISOString() : null,
    lastErrorMsg: c.lastErrorMsg ?? null,
  };
}

/**
 * Coerce raw Channel.events JSON to a typed EventGroupKey[]. Falls back
 * to all 4 groups when the column is missing or malformed (e.g. legacy
 * row from before the migration ran). Unknown values are dropped.
 */
export function parseChannelEvents(raw: unknown): EventGroupKey[] {
  if (!Array.isArray(raw)) return [...ALL_EVENT_GROUPS];
  const valid = new Set<string>(ALL_EVENT_GROUPS);
  const out = raw.filter(
    (v): v is EventGroupKey => typeof v === "string" && valid.has(v),
  );
  return out;
}

/** Serialize a Prisma Subscription (with its channels) for API output. */
export function serializeSubscription(
  sub: PrismaSub & { channels: PrismaChannel[] },
): SubscriptionResponse {
  return {
    id: sub.id,
    validatorId: sub.validatorId.toString(),
    network: sub.network as SubscriptionResponse["network"],
    alertConfig: sub.alertConfig as SubscriptionResponse["alertConfig"],
    customRpcUrl: sub.customRpcUrl,
    customRpcRole: sub.customRpcRole as "primary" | "fallback" | null | undefined,
    walletAddress: sub.walletAddress,
    channels: sub.channels.map(serializeChannel),
    createdAt: sub.createdAt.toISOString(),
  };
}

/**
 * Validate every per-event template inside a channel config. Returns the
 * first failure for early-return, or null on success.
 */
export function validateChannelTemplates(
  channels: ChannelInput[],
): { channelIndex: number; eventType: EventType; unknownPlaceholders: string[] } | null {
  for (let i = 0; i < channels.length; i++) {
    const cfg = channels[i].config;
    for (const tmpls of [cfg.templates, cfg.titleTemplates, cfg.subjectTemplates]) {
      if (!tmpls) continue;
      for (const [evt, str] of Object.entries(tmpls)) {
        if (typeof str !== "string" || str.length === 0) continue;
        const result = validateTemplate(str, evt as EventType);
        if (!result.ok) {
          return {
            channelIndex: i,
            eventType: evt as EventType,
            unknownPlaceholders: result.unknownPlaceholders,
          };
        }
      }
    }
  }
  return null;
}

/** Standard error envelope. */
export function jsonError(
  status: number,
  error: string,
  message?: string,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error, message, details }, { status });
}
