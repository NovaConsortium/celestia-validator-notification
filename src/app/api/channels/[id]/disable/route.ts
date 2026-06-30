import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

/**
 * GET /api/channels/[id]/disable
 *
 * One-click unsubscribe target embedded in alert emails. Behavior:
 *   - no session  → redirect to `/my-alerts` (sign-in prompt)
 *   - wrong owner → redirect to `/my-alerts?disable=forbidden`
 *   - missing row → redirect to `/my-alerts?disable=missing`
 *   - on success  → flip `enabled=false`, redirect to
 *                   `/my-alerts?disabled={channelId}`
 *
 * GET (rather than POST) so the link works from email clients without
 * scripting. Idempotent: re-clicking on an already-disabled channel is
 * a no-op and still returns the success redirect.
 */
interface Ctx {
  params: { id: string };
}

function redirect(req: Request, path: string): NextResponse {
  const base =
    process.env.PUBLIC_URL?.replace(/\/$/u, "") ||
    new URL(req.url).origin;
  return NextResponse.redirect(`${base}${path}`, { status: 302 });
}

export async function GET(req: Request, { params }: Ctx): Promise<NextResponse> {
  const session = await readSession(req).catch(() => null);
  if (!session) {
    return redirect(req, `/my-alerts?disable=signin&id=${encodeURIComponent(params.id)}`);
  }

  const ch = await prisma.channel
    .findUnique({
      where: { id: params.id },
      include: { subscription: true },
    })
    .catch(() => null);
  if (!ch) {
    return redirect(req, "/my-alerts?disable=missing");
  }
  if (ch.subscription.walletAddress.toLowerCase() !== session.addr.toLowerCase()) {
    return redirect(req, "/my-alerts?disable=forbidden");
  }

  if (ch.enabled) {
    await prisma.channel
      .update({ where: { id: ch.id }, data: { enabled: false } })
      .catch(() => {
        /* best-effort */
      });
  }

  return redirect(req, `/my-alerts?disabled=${encodeURIComponent(ch.id)}`);
}
