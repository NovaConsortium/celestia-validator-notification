import { EVENT_LABELS } from "@/channels/templates/defaults";
import type { EventType } from "@/types/events";

/**
 * Build a deterministic sample variable map for a given event type, for
 * use in the live template preview pane. Mirrors the placeholder catalog
 * in `src/channels/templates/schema.ts`.
 */
export function buildSampleVars(event: EventType): Record<string, string> {
  const occurredAt = new Date("2026-04-25T16:30:00Z");
  const base: Record<string, string> = {
    validator_id: "42",
    validator_name: "Sample Validator",
    validator_auth: "celestiavaloper1llfydg9q5fnfuc0lfrwwqnvpywnw97lmvek8jf",
    validator_logo: "",
    network: "mainnet",
    event,
    event_label: EVENT_LABELS[event] ?? event,
    event_status: event === "recovered" ? "ended" : "started",
    severity: severityFor(event),
    occurred_at: `${occurredAt.toISOString().slice(0, 10)} ${occurredAt
      .toISOString()
      .slice(11, 16)} UTC`,
    occurred_at_iso: occurredAt.toISOString(),
    block_number: "12345678",
    slot: "987654",
    epoch: "421",
    explorer_url: "https://celenium.io/validator/42",
    dashboard_url: "https://example.com/my-alerts",
  };

  switch (event) {
    case "offline":
      return { ...base, consecutive_skips: "5" };
    case "delegate":
    case "undelegate":
      return {
        ...base,
        delegator: "celestia1llfydg9q5fnfuc0lfrwwqnvpywnw97lmfx57y0",
        amount_tia: "1,250",
      };
    case "commission_changed":
      return { ...base, old_commission: "5.00%", new_commission: "7.00%" };
    default:
      return base;
  }
}

function severityFor(event: EventType): string {
  switch (event) {
    case "skip":
      return "warning";
    case "offline":
      return "critical";
    case "recovered":
      return "info";
    case "delegate":
    case "undelegate":
    case "commission_changed":
      return "info";
  }
}
