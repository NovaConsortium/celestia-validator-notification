import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { ChannelConfig, ChannelType } from "@/types/channels";
import type { ChannelStatusResponse } from "@/lib/api-types";
import { jsonError } from "@/lib/api-helpers";

interface Ctx {
  params: { id: string };
}

/**
 * GET /api/channels/[id]/status - light-weight poll endpoint used by the
 * Telegram pairing UI. `paired` semantics:
 *   - telegram: chatId set
 *   - everything else: enabled === true
 */
export async function GET(_req: Request, { params }: Ctx): Promise<NextResponse> {
  const ch = await prisma.channel.findUnique({ where: { id: params.id } });
  if (!ch) return jsonError(404, "not_found", "Channel not found");

  const cfg = (ch.config as ChannelConfig) ?? {};
  const type = ch.type as ChannelType;
  const paired = type === "telegram" ? Boolean(cfg.chatId) : ch.enabled;

  const resp: ChannelStatusResponse = {
    id: ch.id,
    type,
    paired,
    enabled: ch.enabled,
    chatTitle: type === "telegram" && paired ? cfg.chatTitle : undefined,
    lastErrorAt: ch.lastErrorAt ? ch.lastErrorAt.toISOString() : null,
    lastErrorMsg: ch.lastErrorMsg ?? null,
  };
  return NextResponse.json(resp);
}
