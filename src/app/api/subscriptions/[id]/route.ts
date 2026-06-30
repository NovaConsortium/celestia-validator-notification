import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  SubscriptionPatchSchema,
  type DeleteSubscriptionResponse,
} from "@/lib/api-types";
import {
  serializeSubscription,
  validateChannelTemplates,
  verifyEmailChannels,
  stripVerifiedTokens,
  findDuplicateChannel,
  findDuplicateChannelType,
  buildChannelKeys,
  jsonError,
} from "@/lib/api-helpers";
import { readSession } from "@/lib/session";
import {
  ALL_EVENT_GROUPS,
  sanitizeChannelEvents,
  type ChannelConfig,
  type EventGroupKey,
} from "@/types/channels";

interface Ctx {
  params: { id: string };
}

/**
 * Subscriptions are owned by the wallet that created them. All routes
 * here require a valid wallet session whose address matches the
 * Subscription.walletAddress.
 */
type OwnershipError = "unauthenticated" | "not_found" | "forbidden";

type SubWithChannels = NonNullable<
  Awaited<ReturnType<typeof prisma.subscription.findUnique>>
> & { channels: Awaited<ReturnType<typeof prisma.channel.findMany>> };

type OwnedResult =
  | { ok: false; error: OwnershipError }
  | { ok: true; sub: SubWithChannels };

async function loadOwned(req: Request, id: string): Promise<OwnedResult> {
  const session = await readSession(req).catch(() => null);
  if (!session) return { ok: false, error: "unauthenticated" };
  const sub = await prisma.subscription.findUnique({
    where: { id },
    include: { channels: true },
  });
  if (!sub) return { ok: false, error: "not_found" };
  if (sub.walletAddress.toLowerCase() !== session.addr.toLowerCase()) {
    return { ok: false, error: "forbidden" };
  }
  return { ok: true, sub: sub as SubWithChannels };
}

function ownershipError(kind: "unauthenticated" | "not_found" | "forbidden"): NextResponse {
  if (kind === "unauthenticated") {
    return jsonError(401, "unauthenticated", "Connect your wallet to manage this alert.");
  }
  if (kind === "forbidden") {
    return jsonError(403, "forbidden", "This alert belongs to a different wallet.");
  }
  return jsonError(404, "not_found", "Subscription not found");
}

/** GET /api/subscriptions/[id] - wallet-owner only. */
export async function GET(req: Request, { params }: Ctx): Promise<NextResponse> {
  const r = await loadOwned(req, params.id);
  if (!r.ok) return ownershipError(r.error);
  return NextResponse.json(serializeSubscription(r.sub));
}

/** PATCH /api/subscriptions/[id] - partial update (wallet-owner only). */
export async function PATCH(req: Request, { params }: Ctx): Promise<NextResponse> {
  const r = await loadOwned(req, params.id);
  if (!r.ok) return ownershipError(r.error);
  const existing = r.sub;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", "Request body must be JSON");
  }

  const parsed = SubscriptionPatchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid_body", "Request body failed validation", {
      issues: parsed.error.issues,
    });
  }
  const patch = parsed.data;

  if (patch.channels) {
    const dupType = findDuplicateChannelType(patch.channels);
    if (dupType) {
      return jsonError(
        409,
        "duplicate_channel_type",
        `Channel ${dupType.channelIndex}: only one ${dupType.type} channel per alert.`,
        dupType,
      );
    }

    const tplErr = validateChannelTemplates(patch.channels);
    if (tplErr) {
      return jsonError(
        400,
        "invalid_template",
        `Channel ${tplErr.channelIndex} ${tplErr.eventType} template references unknown placeholder(s)`,
        {
          channelIndex: tplErr.channelIndex,
          eventType: tplErr.eventType,
          unknownPlaceholders: tplErr.unknownPlaceholders,
        },
      );
    }

    const priorEmailById = new Map<string, string | undefined>();
    for (const c of existing.channels) {
      const cfg = (c.config as ChannelConfig) ?? {};
      if (c.type === "email") {
        priorEmailById.set(c.id, cfg.to?.trim().toLowerCase());
      }
    }
    const emailErr = verifyEmailChannels(patch.channels, priorEmailById);
    if (emailErr) {
      return jsonError(
        400,
        "email_not_verified",
        "Verify your email first: enter address, click Send code, type the OTP from the email, then click Verify.",
        { channelIndex: emailErr.channelIndex, reason: emailErr.reason },
      );
    }
  }

  const existingById = new Map(existing.channels.map((c) => [c.id, c]));
  const sanitizedChannels = patch.channels
    ? stripVerifiedTokens(patch.channels)
    : undefined;

  try {
    await prisma.$transaction(async (tx) => {
      const topData: Record<string, unknown> = {};
      if (patch.alertConfig) {
        topData.alertConfig = {
          ...(existing.alertConfig as Record<string, unknown>),
          ...patch.alertConfig,
        };
      }
      if (patch.customRpcUrl !== undefined) topData.customRpcUrl = patch.customRpcUrl;
      if (patch.customRpcRole !== undefined) topData.customRpcRole = patch.customRpcRole;

      if (Object.keys(topData).length > 0) {
        await tx.subscription.update({
          where: { id: existing.id },
          data: topData,
        });
      }

      if (sanitizedChannels) {
        // Resolve config (merge prior chatId / preserved secrets) BEFORE
        // checking duplicates so the destination key is accurate.
        const resolvedForCheck = sanitizedChannels.map((ch) => {
          const cfg: ChannelConfig = { ...ch.config };
          if (ch.id) {
            const prior = existingById.get(ch.id);
            if (prior) {
              const priorCfg = (prior.config as ChannelConfig) ?? {};
              for (const f of ["webhookUrl", "routingKey"] as const) {
                if (
                  (cfg[f] === undefined || cfg[f] === "") &&
                  priorCfg[f]
                ) {
                  (cfg as Record<string, unknown>)[f] = priorCfg[f];
                }
              }
              if (
                ch.type === "telegram" &&
                (cfg.chatId === undefined || cfg.chatId === "") &&
                priorCfg.chatId
              ) {
                cfg.chatId = priorCfg.chatId;
              }
            }
          }
          return { id: ch.id, type: ch.type, config: cfg, enabled: ch.enabled };
        });

        const ownIds = new Set(existing.channels.map((c) => c.id));
        const dup = await findDuplicateChannel(
          tx,
          existing.validatorId,
          existing.network,
          resolvedForCheck,
          ownIds,
        );
        if (dup) {
          throw Object.assign(new Error("duplicate_channel"), {
            code: "duplicate_channel",
            info: dup,
          });
        }

        const incomingIds = new Set(
          sanitizedChannels.filter((c) => c.id).map((c) => c.id as string),
        );
        const toDelete = existing.channels
          .filter((c) => !incomingIds.has(c.id))
          .map((c) => c.id);
        if (toDelete.length > 0) {
          await tx.telegramPairing.deleteMany({
            where: { channelId: { in: toDelete } },
          });
          await tx.channel.deleteMany({ where: { id: { in: toDelete } } });
        }

        for (const ch of sanitizedChannels) {
          const cfg: ChannelConfig = { ...ch.config };
          if (ch.id) {
            const prior = existingById.get(ch.id);
            if (prior) {
              const priorCfg = (prior.config as ChannelConfig) ?? {};
              for (const f of ["webhookUrl", "routingKey"] as const) {
                const incoming = cfg[f];
                const prev = priorCfg[f];
                if ((incoming === undefined || incoming === "") && prev) {
                  (cfg as Record<string, unknown>)[f] = prev;
                }
              }
              // chatId is written server-side by the Telegram bot during
              // pairing - the client never knows it. Preserve the prior
              // value if the incoming PATCH didn't carry one.
              if (ch.type === "telegram") {
                const incomingChatId = cfg.chatId;
                if (
                  (incomingChatId === undefined || incomingChatId === "") &&
                  priorCfg.chatId
                ) {
                  cfg.chatId = priorCfg.chatId;
                }
              }
            }
          }
          const events: EventGroupKey[] = sanitizeChannelEvents(
            ch.type,
            ch.events ?? [...ALL_EVENT_GROUPS],
          );
          // Recompute destKey on every PATCH so a config edit that
          // changes the destination (e.g. swap chatId, change webhook)
          // is reflected at the DB-constraint level.
          const keys = buildChannelKeys(
            ch.type,
            cfg,
            existing.validatorId,
            existing.network,
          );
          if (ch.id && existingById.has(ch.id)) {
            await tx.channel.update({
              where: { id: ch.id },
              data: {
                type: ch.type,
                config: cfg as object,
                enabled: ch.enabled ?? true,
                events: events as object,
                destKey: keys.destKey,
                validatorNetKey: keys.validatorNetKey,
              },
            });
          } else {
            await tx.channel.create({
              data: {
                subscriptionId: existing.id,
                type: ch.type,
                config: cfg as object,
                enabled: ch.enabled ?? true,
                events: events as object,
                destKey: keys.destKey,
                validatorNetKey: keys.validatorNetKey,
              },
            });
          }
        }
      }
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "duplicate_channel") {
      const info = (err as { info?: { channelIndex: number; destination: string } })
        .info;
      return jsonError(
        409,
        "duplicate_channel",
        info
          ? `Channel ${info.channelIndex}: ${info.destination} is already tracking this validator.`
          : "This destination is already tracking this validator.",
        info,
      );
    }
    // Partial unique violation from the hardening_pack migration.
    if (code === "P2002") {
      return jsonError(
        409,
        "duplicate_channel",
        "This destination is already tracking this validator.",
      );
    }
    // eslint-disable-next-line no-console
    console.error("[subscriptions] patch failed:", (err as Error).message);
    return jsonError(500, "patch_failed", "Could not update subscription");
  }

  const updated = await prisma.subscription.findUnique({
    where: { id: existing.id },
    include: { channels: true },
  });
  if (!updated) return jsonError(500, "patch_failed", "Could not refetch after patch");
  return NextResponse.json(serializeSubscription(updated));
}

/** DELETE /api/subscriptions/[id] - wallet-owner only. */
export async function DELETE(req: Request, { params }: Ctx): Promise<NextResponse> {
  const r = await loadOwned(req, params.id);
  if (!r.ok) return ownershipError(r.error);
  const sub = r.sub;

  try {
    await prisma.$transaction(async (tx) => {
      const channelIds = sub.channels.map((c) => c.id);
      if (channelIds.length > 0) {
        await tx.telegramPairing.deleteMany({
          where: { channelId: { in: channelIds } },
        });
      }
      await tx.subscription.delete({ where: { id: sub.id } });
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[subscriptions] delete failed:", (err as Error).message);
    return jsonError(500, "delete_failed", "Could not delete subscription");
  }

  const resp: DeleteSubscriptionResponse = { ok: true };
  return NextResponse.json(resp, { status: 200 });
}
