import type { EventType } from "@/types/events";

/**
 * Placeholder catalog for user-customizable message templates.
 *
 * COMMON_PLACEHOLDERS apply to every event type. PER_EVENT_PLACEHOLDERS
 * adds event-specific extras. Wave-2 validators reject unknown
 * placeholders at save-time and substitute empty string at render-time
 * for known-but-missing values.
 */
export const COMMON_PLACEHOLDERS = [
  "validator_id",
  "validator_name",
  "validator_auth",
  "validator_logo",
  "network",
  "event",
  "event_label",
  "event_status",
  "severity",
  "occurred_at",
  "occurred_at_iso",
  "block_number",
  "slot",
  "epoch",
  "explorer_url",
  "dashboard_url",
] as const;

export type CommonPlaceholder = (typeof COMMON_PLACEHOLDERS)[number];

export const PER_EVENT_PLACEHOLDERS: Record<EventType, readonly string[]> = {
  skip: [],
  offline: ["consecutive_skips"],
  recovered: [],
  delegate: ["delegator", "amount_tia"],
  undelegate: ["delegator", "amount_tia"],
  commission_changed: ["old_commission", "new_commission"],
} as const;

/**
 * Full set of allowed placeholders for a given event type
 * (common + event-specific).
 */
export function placeholdersFor(event: EventType): readonly string[] {
  return [...COMMON_PLACEHOLDERS, ...PER_EVENT_PLACEHOLDERS[event]];
}

/**
 * Map of every event type to its complete allowed placeholder set.
 * Useful for static validation of templates client-side.
 */
export const PLACEHOLDER_SCHEMA: Record<EventType, readonly string[]> = {
  skip: placeholdersFor("skip"),
  offline: placeholdersFor("offline"),
  recovered: placeholdersFor("recovered"),
  delegate: placeholdersFor("delegate"),
  undelegate: placeholdersFor("undelegate"),
  commission_changed: placeholdersFor("commission_changed"),
} as const;
