import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  ValidatorEventsQuerySchema,
  type ValidatorEventsResponse,
  type ValidatorEventSummary,
} from "@/lib/api-types";
import { jsonError } from "@/lib/api-helpers";
import type { EventType, Severity } from "@/types/events";

interface Ctx {
  params: { id: string };
}

/**
 * GET /api/validators/[id]/events?limit=20&network=mainnet
 *
 * Public read of recent events. No subscriber info is leaked because
 * Event has no FK to Subscription.
 */
export async function GET(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!/^\d+$/u.test(params.id)) {
    return jsonError(400, "invalid_id", "validator id must be a base-10 integer");
  }

  const url = new URL(req.url);
  const queryParsed = ValidatorEventsQuerySchema.safeParse({
    network: url.searchParams.get("network") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!queryParsed.success) {
    return jsonError(400, "invalid_query", "Bad query string", {
      issues: queryParsed.error.issues,
    });
  }
  const { network, limit } = queryParsed.data;

  const validatorIdBig = BigInt(params.id);

  const rows = await prisma.event.findMany({
    where: { validatorId: validatorIdBig, network },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });

  const events: ValidatorEventSummary[] = rows.map((e) => ({
    id: e.id,
    type: e.type as EventType,
    severity: e.severity as Severity,
    occurredAt: e.occurredAt.toISOString(),
    blockNumber: e.blockNumber !== null ? e.blockNumber.toString() : null,
    payload: (e.payload as Record<string, unknown>) ?? {},
  }));

  const resp: ValidatorEventsResponse = { events };
  return NextResponse.json(resp);
}
