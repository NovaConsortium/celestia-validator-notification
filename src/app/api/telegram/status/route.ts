import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api-helpers";
import type { TelegramPairingStatusResponse } from "@/lib/api-types";

/**
 * GET /api/telegram/status?token=<token>
 *
 * Used by the wallet-scoped pairing flow on the create page. Returns:
 *  - paired: true once the bot has written a chatId to the pairing row
 *  - expired: true when the pairing's TTL has elapsed
 *
 * The chatId itself is never exposed to the client - submit the token
 * via /api/subscriptions and the backend resolves it server-side.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return jsonError(400, "missing_token", "token query param is required");
  }

  const pairing = await prisma.telegramPairing.findUnique({
    where: { token },
  });
  if (!pairing) {
    return jsonError(404, "pairing_not_found", "Unknown pairing token");
  }

  const now = new Date();
  const expired = pairing.expiresAt < now;
  const paired = !expired && pairing.chatId !== null && !pairing.consumed;

  const resp: TelegramPairingStatusResponse = {
    paired,
    expired: expired || undefined,
    chatTitle: paired && pairing.chatTitle ? pairing.chatTitle : undefined,
    error: pairing.error ?? undefined,
  };
  return NextResponse.json(resp, {
    headers: { "cache-control": "no-store" },
  });
}
