import {
  formatAmountTia,
  formatCommissionPct,
  relativeTime,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ValidatorEventSummary } from "@/lib/api-types";
import type { EventType } from "@/types/events";

interface RecentAlertsFeedProps {
  events: ValidatorEventSummary[];
}

const TYPE_LABEL: Record<EventType, string> = {
  skip: "Skip",
  offline: "Offline",
  recovered: "Recovered",
  delegate: "Delegate",
  undelegate: "Undelegate",
  commission_changed: "Commission",
};

const TYPE_CHIP: Record<EventType, string> = {
  skip: "border-red-500/30 bg-red-500/10 text-red-300",
  offline: "border-red-500/40 bg-red-500/15 text-red-200",
  recovered: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  delegate: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  undelegate: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  commission_changed: "border-yellow-500/30 bg-yellow-500/10 text-yellow-200",
};

const AMOUNT_COLOR: Partial<Record<EventType, string>> = {
  delegate: "text-emerald-300",
  undelegate: "text-amber-300",
  commission_changed: "text-yellow-200",
};

interface DetailParts {
  prefix?: string;
  amount?: string;
  withTiaUnit?: boolean;
  text?: string;
}

function eventDetail(e: ValidatorEventSummary): DetailParts | null {
  const p = e.payload ?? {};
  if (e.type === "delegate") {
    const amt = formatAmountTia(p.amount);
    return amt ? { prefix: "+", amount: amt, withTiaUnit: true } : null;
  }
  if (e.type === "undelegate") {
    const amt = formatAmountTia(p.amount);
    return amt ? { prefix: "−", amount: amt, withTiaUnit: true } : null;
  }
  if (e.type === "commission_changed") {
    const oldC = formatCommissionPct(p.oldCommission ?? p.old_commission);
    const newC = formatCommissionPct(p.newCommission ?? p.new_commission);
    if (oldC && newC) return { text: `${oldC} → ${newC}` };
    return null;
  }
  return null;
}

export function RecentAlertsFeed({
  events,
}: RecentAlertsFeedProps): JSX.Element {
  if (events.length === 0) {
    return (
      <div className="flex min-h-[480px] items-center justify-center rounded-md border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          No alerts yet for this validator.
        </p>
      </div>
    );
  }
  return (
    <div className="min-h-[480px] rounded-md border bg-card p-3">
      <ul className="flex flex-col gap-2">
        {events.map((e) => {
          const detail = eventDetail(e);
          const amountClass = AMOUNT_COLOR[e.type] ?? "text-foreground/85";
          return (
            <li
              key={e.id}
              className="flex items-center justify-between gap-4 rounded-md border border-foreground/10 bg-background/40 px-4 py-3 transition-colors hover:border-foreground/25"
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-2xs font-semibold uppercase tracking-micro",
                    TYPE_CHIP[e.type],
                  )}
                >
                  {TYPE_LABEL[e.type] ?? e.type}
                </span>
                {detail ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 font-mono text-xs tabular-nums",
                      amountClass,
                    )}
                  >
                    {detail.text ? (
                      detail.text
                    ) : (
                      <>
                        {detail.prefix}
                        {detail.amount}
                        {detail.withTiaUnit ? (
                          <span className="text-2xs text-primary">TIA</span>
                        ) : null}
                      </>
                    )}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-muted-foreground">
                  {relativeTime(e.occurredAt)}
                </span>
                {e.blockNumber ? (
                  <a
                    href={`https://celenium.io/block/${e.blockNumber}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-muted-foreground transition-colors hover:text-primary hover:underline"
                  >
                    block #{e.blockNumber}
                  </a>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
