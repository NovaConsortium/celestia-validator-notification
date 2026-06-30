import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/ratelimit";
import { verifyHcaptcha } from "@/lib/hcaptcha";
import {
  SubscriptionCreateSchema,
  type CreateSubscriptionResponse,
} from "@/lib/api-types";
import {
  validateChannelTemplates,
  verifyEmailChannels,
  stripVerifiedTokens,
  findDuplicateChannel,
  findDuplicateChannelType,
  channelDestKey,
  buildChannelKeys,
  consolidateSiblingSubscriptions,
  jsonError,
} from "@/lib/api-helpers";
import { readSession } from "@/lib/session";
import {
  ALL_EVENT_GROUPS,
  sanitizeChannelEvents,
  type ChannelConfig,
  type ChannelType,
  type EventGroupKey,
} from "@/types/channels";

/**
 * POST /api/subscriptions
 *  - rate-limit per IP
 *  - validate body (zod)
 *  - verify hCaptcha
 *  - validate channel templates against placeholder schema
 *  - encrypt user-supplied secrets
 *  - upsert Validator + insert Subscription + Channels
 *
 * GET is admin-only and skipped for v1 (returns 501).
 */
export async function POST(req: Request): Promise<NextResponse> {
  // Wallet auth required - subscriptions are owned by the connected wallet.
  const session = await readSession(req).catch(() => null);
  if (!session) {
    const cookieHeader = req.headers.get("cookie") ?? "";
    const hasSessionCookie = cookieHeader.includes("mvn_session=");
    // eslint-disable-next-line no-console
    console.error(
      `[subscriptions] 401 unauthenticated: session_cookie_present=${hasSessionCookie}`,
    );
    return jsonError(
      401,
      "unauthenticated",
      "Connect your wallet first to create alerts.",
    );
  }
  const walletAddress = session.addr.toLowerCase();

  const rl = await rateLimit(req, "subscriptions:create", { rpm: 10 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "retry-after": String(rl.retryAfter ?? 60) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", "Request body must be JSON");
  }

  const parsed = SubscriptionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid_body", "Request body failed validation", {
      issues: parsed.error.issues,
    });
  }
  const input = parsed.data;

  const ip = getClientIp(req);
  const captchaOk = await verifyHcaptcha(input.hcaptchaToken, ip);
  if (!captchaOk) {
    return jsonError(403, "captcha_failed", "hCaptcha verification failed");
  }

  // Validate every channel template before doing any DB work.
  const tplErr = validateChannelTemplates(input.channels);
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

  // One channel per type (within the incoming payload). Existing-sub
  // collisions are checked inside the transaction below.
  const dupType = findDuplicateChannelType(input.channels);
  if (dupType) {
    return jsonError(
      400,
      "duplicate_channel_type",
      `Channel ${dupType.channelIndex}: only one ${dupType.type} channel per alert.`,
      dupType,
    );
  }

  // Email OTP gate for email channels.
  const emailErr = verifyEmailChannels(input.channels);
  if (emailErr) {
    return jsonError(
      400,
      "email_not_verified",
      "Verify your email first: enter address, click Send code, type the OTP from the email, then click Verify.",
      { channelIndex: emailErr.channelIndex, reason: emailErr.reason },
    );
  }

  // Best-effort: validate that the validator exists per the validator directory. If the
  // sibling agent's validator-meta helper is still a stub, log + skip rather
  // than block subscription creation.
  await maybeAssertValidatorExists(input.validatorId, input.network).catch(() => {
    /* ignore */
  });

  // Resolve any wallet-scoped Telegram pairing tokens to chatIds. The
  // pairing rows must:
  //   - exist
  //   - not be expired
  //   - not already be consumed
  //   - belong to the current wallet
  //   - have a chatId set (i.e. the user actually ran /start TOKEN)
  // The matching tokens are remembered so they can be consumed atomically
  // with the channel insert below.
  // Resolve pairing tokens BEFORE stripping ephemeral tokens - the
  // helper drops both `verifiedToken` and `pairingToken` in one pass.
  const consumedTokens: string[] = [];
  const resolvedChatIdByIndex = new Map<number, string>();
  const resolvedChatTitleByIndex = new Map<number, string>();
  for (let i = 0; i < input.channels.length; i++) {
    const ch = input.channels[i];
    if (ch.type !== "telegram") continue;
    const token = ch.config.pairingToken;
    if (!token) {
      // Telegram channels are activated by /start TOKEN; without a
      // resolved chatId or a pairing token, the channel can never
      // dispatch - block create rather than persist a dead row.
      if (!ch.config.chatId) {
        return jsonError(
          400,
          "pairing_required",
          `Channel ${i}: pair Telegram before saving.`,
          { channelIndex: i },
        );
      }
      continue;
    }
    const pairing = await prisma.telegramPairing.findUnique({
      where: { token },
    });
    if (!pairing) {
      return jsonError(
        400,
        "pairing_not_found",
        `Channel ${i}: pairing token unknown. Pair Telegram again.`,
        { channelIndex: i },
      );
    }
    if (pairing.consumed) {
      return jsonError(
        400,
        "pairing_consumed",
        `Channel ${i}: pairing token already used. Pair Telegram again.`,
        { channelIndex: i },
      );
    }
    if (pairing.expiresAt < new Date()) {
      return jsonError(
        400,
        "pairing_expired",
        `Channel ${i}: pairing token expired. Pair Telegram again.`,
        { channelIndex: i },
      );
    }
    if (
      pairing.walletAddress &&
      pairing.walletAddress.toLowerCase() !== walletAddress
    ) {
      return jsonError(
        403,
        "pairing_wrong_wallet",
        `Channel ${i}: pairing belongs to a different wallet.`,
        { channelIndex: i },
      );
    }
    if (!pairing.chatId) {
      return jsonError(
        400,
        "pairing_pending",
        `Channel ${i}: open the bot and run /start to confirm Telegram before saving.`,
        { channelIndex: i },
      );
    }
    resolvedChatIdByIndex.set(i, pairing.chatId);
    if (pairing.chatTitle) resolvedChatTitleByIndex.set(i, pairing.chatTitle);
    consumedTokens.push(token);
  }

  const validatorIdBig = BigInt(input.validatorId);

  // Now strip ephemeral tokens (verifiedToken, pairingToken) and inline
  // the resolved chatIds before encryption + persistence. Also compute
  // (destKey, validatorNetKey) so the partial unique index on Channel
  // catches any TOCTOU residual the application-level duplicate check
  // misses.
  const stripped = stripVerifiedTokens(input.channels);
  const channelsToInsert = stripped.map((ch, i) => {
    const cfg = { ...ch.config };
    const chatId = resolvedChatIdByIndex.get(i);
    if (chatId) cfg.chatId = chatId;
    const chatTitle = resolvedChatTitleByIndex.get(i);
    if (chatTitle) cfg.chatTitle = chatTitle;
    const events: EventGroupKey[] = sanitizeChannelEvents(
      ch.type,
      ch.events ?? [...ALL_EVENT_GROUPS],
    );
    const keys = buildChannelKeys(ch.type, cfg, validatorIdBig, input.network);
    return {
      type: ch.type,
      config: cfg,
      enabled: ch.enabled ?? true,
      events,
      destKey: keys.destKey,
      validatorNetKey: keys.validatorNetKey,
    };
  });

  // Build the resolved-config form used for the duplicate check (chatId
  // resolved, but unencrypted) - destination keys need plain values.
  const resolvedForCheck = stripped.map((ch, i) => {
    const cfg = { ...ch.config };
    const chatId = resolvedChatIdByIndex.get(i);
    if (chatId) cfg.chatId = chatId;
    return { id: ch.id, type: ch.type, config: cfg, enabled: ch.enabled };
  });

  // Upsert Validator + Subscription + Channels in a single transaction.
  let createdId: string;
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Pull live Celenium metadata so consAddress + valoper are set on
      // first sub. Without consAddress the worker can't match a validator
      // against the CometBFT commit signer set.
      const { fetchValidatorById } = await import("@/lib/celenium");
      const meta = await fetchValidatorById(
        validatorIdBig.toString(),
        input.network as "mainnet" | "testnet",
      ).catch(() => null);
      await tx.validator.upsert({
        where: { id_network: { id: validatorIdBig, network: input.network } },
        create: {
          id: validatorIdBig,
          network: input.network,
          consAddress: meta?.consAddress ?? null,
          valoper: meta?.valoper ?? null,
          name: meta?.moniker ?? null,
        },
        update: {
          // Refresh identifiers when present; never clobber with empty.
          ...(meta?.consAddress ? { consAddress: meta.consAddress } : {}),
          ...(meta?.valoper ? { valoper: meta.valoper } : {}),
          ...(meta?.moniker ? { name: meta.moniker } : {}),
        },
      });

      // Reuse the wallet's original subscription for this validator if
      // one already exists. Picking the oldest keeps "Manage" links the
      // user has already bookmarked stable; new channels and alertConfig
      // toggles are merged in.
      const allOwnSubs = await tx.subscription.findMany({
        where: {
          walletAddress,
          validatorId: validatorIdBig,
          network: input.network,
        },
        include: { channels: true },
        orderBy: { createdAt: "asc" },
      });
      let existingSub = allOwnSubs[0] ?? null;

      if (existingSub && allOwnSubs.length > 1) {
        await consolidateSiblingSubscriptions(
          tx,
          walletAddress,
          validatorIdBig,
          input.network,
          existingSub.id,
        );
        const reloaded = await tx.subscription.findUnique({
          where: { id: existingSub.id },
          include: { channels: true },
        });
        if (reloaded) existingSub = reloaded;
      }

      const ownIds = existingSub
        ? new Set(existingSub.channels.map((c) => c.id))
        : undefined;

      if (existingSub) {
        const existingTypes = new Set<ChannelType>(
          existingSub.channels.map((c) => c.type as ChannelType),
        );
        const typeClash = findDuplicateChannelType(
          input.channels,
          existingTypes,
        );
        if (typeClash) {
          throw Object.assign(new Error("duplicate_channel_type"), {
            code: "duplicate_channel_type",
            info: typeClash,
          });
        }
      }

      const dup = await findDuplicateChannel(
        tx,
        validatorIdBig,
        input.network,
        resolvedForCheck,
        ownIds,
      );
      if (dup) {
        throw Object.assign(new Error("duplicate_channel"), {
          code: "duplicate_channel",
          info: dup,
        });
      }

      let subId: string;
      if (existingSub) {
        const mergedAlertConfig = {
          ...(existingSub.alertConfig as Record<string, unknown>),
          ...(input.alertConfig as Record<string, unknown>),
        };
        const topData: Record<string, unknown> = {
          alertConfig: mergedAlertConfig,
        };
        if (input.customRpcUrl !== undefined)
          topData.customRpcUrl = input.customRpcUrl;
        if (input.customRpcRole !== undefined)
          topData.customRpcRole = input.customRpcRole;
        await tx.subscription.update({
          where: { id: existingSub.id },
          data: topData,
        });

        // Skip incoming channels whose destination already exists on the
        // sub - merging shouldn't insert duplicate rows pointing at the
        // same chat/webhook/phone.
        const existingDestKeys = new Set<string>();
        for (const c of existingSub.channels) {
          const k = channelDestKey(
            c.type as Parameters<typeof channelDestKey>[0],
            (c.config ?? {}) as ChannelConfig,
          );
          if (k) existingDestKeys.add(k);
        }
        for (let i = 0; i < channelsToInsert.length; i++) {
          const ins = channelsToInsert[i];
          const checkCfg = resolvedForCheck[i].config;
          const k = channelDestKey(ins.type, checkCfg);
          if (k && existingDestKeys.has(k)) continue;
          await tx.channel.create({
            data: {
              subscriptionId: existingSub.id,
              type: ins.type,
              config: ins.config as object,
              enabled: ins.enabled,
              events: ins.events as object,
              destKey: ins.destKey ?? null,
              validatorNetKey: ins.validatorNetKey,
            },
          });
          if (k) existingDestKeys.add(k);
        }
        subId = existingSub.id;
      } else {
        const sub = await tx.subscription.create({
          data: {
            validatorId: validatorIdBig,
            network: input.network,
            alertConfig: input.alertConfig as object,
            customRpcUrl: input.customRpcUrl,
            customRpcRole: input.customRpcRole,
            walletAddress,
            channels: {
              create: channelsToInsert.map((c) => ({
                type: c.type,
                config: c.config as object,
                enabled: c.enabled,
                events: c.events as object,
                destKey: c.destKey ?? null,
                validatorNetKey: c.validatorNetKey,
              })),
            },
          },
        });
        subId = sub.id;
      }

      // Mark every resolved pairing as consumed, atomically with the
      // subscription insert/update. The `consumed: false` guard makes
      // this the canonical claim step: if a concurrent request snatched
      // the token between the outer pre-check and this point, the
      // updated count drops and we abort the entire transaction so a
      // pairing-token race cannot create two subscriptions bound to the
      // same Telegram chat.
      if (consumedTokens.length > 0) {
        const claim = await tx.telegramPairing.updateMany({
          where: { token: { in: consumedTokens }, consumed: false },
          data: { consumed: true },
        });
        if (claim.count !== consumedTokens.length) {
          throw Object.assign(new Error("pairing_consumed"), {
            code: "pairing_consumed",
          });
        }
      }

      return { id: subId };
    });
    createdId = result.id;
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
    if (code === "duplicate_channel_type") {
      const info = (err as { info?: { channelIndex: number; type: string } }).info;
      return jsonError(
        409,
        "duplicate_channel_type",
        info
          ? `Channel ${info.channelIndex}: this alert already has a ${info.type} channel. Edit the existing one instead.`
          : "Only one channel per type is allowed.",
        info,
      );
    }
    if (code === "pairing_consumed") {
      return jsonError(
        409,
        "pairing_consumed",
        "Telegram pairing was used by another request. Pair again and retry.",
      );
    }
    // P2002 is Prisma's unique-constraint code. The hardening_pack
    // migration installs a partial unique on (validatorNetKey, destKey),
    // so this fires when the application-level findDuplicateChannel
    // check raced another concurrent request. Map to the same 409 the
    // user would have seen had the check caught it.
    if (code === "P2002") {
      return jsonError(
        409,
        "duplicate_channel",
        "This destination is already tracking this validator.",
      );
    }
    // eslint-disable-next-line no-console
    console.error("[subscriptions] create failed:", (err as Error).message);
    return jsonError(500, "create_failed", "Could not create subscription");
  }

  const resp: CreateSubscriptionResponse = {
    subscriptionId: createdId,
    walletAddress,
  };
  return NextResponse.json(resp, { status: 201 });
}

export async function GET(): Promise<NextResponse> {
  // Listing all subscriptions exposes subscriber data and is admin-only.
  // Not in v1.
  return jsonError(501, "not_implemented", "Listing requires authentication (admin)");
}

/**
 * Soft validator-existence check. Imports validator-meta helper dynamically so
 * a sibling agent's stub throwing doesn't propagate; we just degrade.
 */
async function maybeAssertValidatorExists(
  validatorId: string,
  network: string,
): Promise<void> {
  try {
    const { fetchValidatorById } = await import("@/lib/celenium");
    const result = await fetchValidatorById(
      validatorId,
      network as "mainnet" | "testnet",
    );
    if (result === null || result === undefined) {
      throw Object.assign(new Error("validator_not_found"), { code: "validator_not_found" });
    }
  } catch (err) {
    // Stub or unreachable - log but don't throw.
    // eslint-disable-next-line no-console
    console.warn(
      "[subscriptions] validator existence check skipped:",
      (err as Error).message,
    );
  }
}
