import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import {
  consolidateSiblingSubscriptions,
  serializeSubscription,
  jsonError,
} from "@/lib/api-helpers";
import { fetchValidatorMetadata } from "@/lib/validator-meta";
import type { MineValidatorInfo } from "@/lib/api-types";
import type { Network } from "@/types/events";

/**
 * GET /api/subscriptions/mine - returns every subscription whose
 * walletAddress matches the caller's session. Requires a valid session
 * cookie. Channel secrets are redacted by serializeSubscription.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await readSession(req);
  if (!session) {
    return jsonError(401, "unauthenticated", "Connect a wallet to view saved alerts");
  }
  const wallet = session.addr.toLowerCase();
  try {
    // Single fetch with channels - we sort/dedup in memory rather than
    // round-tripping the DB twice. Subs are bounded per wallet.
    let subs = await prisma.subscription.findMany({
      where: { walletAddress: wallet },
      include: { channels: true },
      orderBy: { createdAt: "asc" },
    });

    // Detect duplicate (wallet, validator, network) groups in memory.
    const groups = new Map<
      string,
      { canonicalId: string; validatorId: bigint; network: string; count: number }
    >();
    for (const s of subs) {
      const k = `${s.network}:${s.validatorId.toString()}`;
      const g = groups.get(k);
      if (g) {
        g.count += 1;
      } else {
        groups.set(k, {
          canonicalId: s.id,
          validatorId: s.validatorId,
          network: s.network,
          count: 1,
        });
      }
    }
    const dupGroups = [...groups.values()].filter((g) => g.count > 1);

    if (dupGroups.length > 0) {
      // Only re-enter Prisma for actual duplicates. Each group runs in its
      // own short transaction; safe to parallelize since they touch
      // disjoint validator/network keys.
      await Promise.all(
        dupGroups.map((g) =>
          prisma.$transaction((tx) =>
            consolidateSiblingSubscriptions(
              tx,
              wallet,
              g.validatorId,
              g.network,
              g.canonicalId,
            ),
          ),
        ),
      );
      // Re-query post-consolidation to reflect the merged state.
      subs = await prisma.subscription.findMany({
        where: { walletAddress: wallet },
        include: { channels: true },
        orderBy: { createdAt: "desc" },
      });
    } else {
      // No DB writes; just sort desc in memory.
      subs = [...subs].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
    }

    const serialized = subs.map(serializeSubscription);

    // Only ship metadata for validators the user actually subscribes to.
    // The full list per network is hundreds of entries; we want a few.
    const wantedKeys = new Set(
      serialized.map((s) => `${s.network}:${s.validatorId}`),
    );
    const networks = Array.from(
      new Set(serialized.map((s) => s.network)),
    ) as Network[];
    const validators: Record<string, MineValidatorInfo> = {};
    await Promise.all(
      networks.map(async (network) => {
        const list = await fetchValidatorMetadata(network);
        for (const v of list) {
          const key = `${network}:${v.id}`;
          if (wantedKeys.has(key)) {
            validators[key] = { name: v.name, logo: v.logo };
          }
        }
      }),
    );

    return NextResponse.json({
      subscriptions: serialized,
      validators,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[subscriptions/mine] failed:", (err as Error).message);
    return jsonError(500, "list_failed", "Could not list subscriptions");
  }
}
