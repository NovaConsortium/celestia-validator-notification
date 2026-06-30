import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SyntheticEventSchema } from "@/lib/api-types";
import { jsonError } from "@/lib/api-helpers";
import type { Severity, EventType } from "@/types/events";

/**
 * POST /api/dev/synthetic-event
 *
 * Dev-only endpoint that injects a fake event. Inserts an Event row and
 * (best-effort) hands it to the channel dispatcher. Gated by NODE_ENV ===
 * 'production'.
 */

const SEVERITY_FOR: Record<EventType, Severity> = {
  skip: "warning",
  offline: "critical",
  recovered: "info",
  delegate: "info",
  undelegate: "info",
  commission_changed: "info",
};

export async function POST(req: Request): Promise<NextResponse> {
  if (process.env.NODE_ENV === "production") {
    return jsonError(403, "disabled", "Synthetic events are disabled in production");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", "Request body must be JSON");
  }
  const parsed = SyntheticEventSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid_body", "Request body failed validation", {
      issues: parsed.error.issues,
    });
  }
  const { validatorId, network, type, severity, payload } = parsed.data;

  const validatorIdBig = BigInt(validatorId);

  // Make sure the validator row exists so the FK doesn't blow up.
  await prisma.validator.upsert({
    where: { id_network: { id: validatorIdBig, network } },
    create: { id: validatorIdBig, network },
    update: {},
  });

  const event = await prisma.event.create({
    data: {
      validatorId: validatorIdBig,
      network,
      type,
      severity: severity ?? SEVERITY_FOR[type] ?? "info",
      payload: (payload ?? {}) as object,
      occurredAt: new Date(),
    },
  });

  // Best-effort dispatch via the channels dispatcher's DB-backed poller.
  // The poller picks up the just-inserted event, looks up subscriptions,
  // and fans out. If the poller isn't available we still return success
  // and surface dispatched=false so callers can tell.
  let dispatched = false;
  try {
    const mod: unknown = await import("@/channels/dispatcher");
    const poll = (mod as { pollAndDispatch?: () => Promise<void> }).pollAndDispatch;
    if (typeof poll === "function") {
      await poll();
      dispatched = true;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[dev.synthetic-event] dispatch skipped:", (err as Error).message);
  }

  return NextResponse.json(
    {
      eventId: event.id,
      dispatched,
    },
    { status: 201 },
  );
}
