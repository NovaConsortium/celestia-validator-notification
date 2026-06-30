import type { EventType, ValidatorEvent } from "@/types/events";
import type { ValidatorContext } from "@/types/channels";
import {
  formatAmountTia,
  formatCommissionPct as formatCommission,
} from "@/lib/format";
import { validatorExplorerUrl } from "@/lib/chain";
import { EVENT_LABELS } from "./defaults";
import { placeholdersFor } from "./schema";

/**
 * Replace every `{key}` in `template` with `vars[key]`.
 * Missing keys -> empty string + console.warn.
 */
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-z_][a-z0-9_]*)\}/gi, (_match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return vars[key];
    }
    // eslint-disable-next-line no-console
    console.warn(`[template:render] missing placeholder "{${key}}"`);
    return "";
  });
}

/**
 * Build the full placeholder map for an event.
 * - bigints stringified
 * - amounts: formatEther on payload.amount (string-or-bigint)
 * - commission: scaled by 1e18, expressed as percent with 2 decimals
 */
export function buildVars(
  event: ValidatorEvent,
  validator: ValidatorContext,
  opts: { publicUrl: string },
): Record<string, string> {
  const vid = validator.id.toString();
  const vname = validator.name && validator.name.length > 0 ? validator.name : vid;
  const vauth = validator.authAddress ?? "";
  const vlogo = validator.logoUrl ?? "";
  const network = event.network;
  const occurredAtIso = event.occurredAt.toISOString();
  const occurredAt = occurredAtIso.replace("T", " ").slice(0, 16) + " UTC";

  const eventStatus = event.type === "recovered" ? "ended" : "started";

  const block =
    event.blockNumber !== undefined && event.blockNumber !== null
      ? event.blockNumber.toString()
      : "";

  const payload = event.payload ?? {};

  const slot = readScalar(payload["slot"]);
  const epoch = readScalar(payload["epoch"]);
  const consecutiveSkips = readScalar(
    payload["consecutiveSkips"] ?? payload["consecutive_skips"],
  );
  const delegator = readScalar(payload["delegator"]);

  const amountTia = formatAmountTia(payload["amount"]);
  const oldCommission = formatCommission(payload["oldCommission"] ?? payload["old_commission"]);
  const newCommission = formatCommission(payload["newCommission"] ?? payload["new_commission"]);

  const explorerUrl = validatorExplorerUrl(vid, network);
  const dashboardUrl = `${opts.publicUrl}/my-alerts`;

  return {
    validator_id: vid,
    validator_name: vname,
    validator_auth: vauth,
    validator_logo: vlogo,
    network,
    event: event.type,
    event_label: EVENT_LABELS[event.type] ?? event.type,
    event_status: eventStatus,
    severity: event.severity,
    occurred_at: occurredAt,
    occurred_at_iso: occurredAtIso,
    block_number: block,
    slot,
    epoch,
    consecutive_skips: consecutiveSkips,
    delegator,
    amount_tia: amountTia,
    old_commission: oldCommission,
    new_commission: newCommission,
    explorer_url: explorerUrl,
    dashboard_url: dashboardUrl,
  };
}

/**
 * Static-validate a template against the placeholder schema for an event.
 * Returns ok=false with the list of unknown placeholders so the API agent can
 * surface a helpful error to operators.
 */
export function validateTemplate(
  template: string,
  eventType: EventType,
): { ok: boolean; unknownPlaceholders: string[] } {
  const allowed = new Set(placeholdersFor(eventType));
  const found = new Set<string>();
  const re = /\{([a-z_][a-z0-9_]*)\}/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(template)) !== null) {
    found.add(match[1]);
  }
  const unknown: string[] = [];
  for (const key of found) {
    if (!allowed.has(key)) unknown.push(key);
  }
  return { ok: unknown.length === 0, unknownPlaceholders: unknown };
}

/* ---------------- helpers ---------------- */

function readScalar(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

