import type { EventType } from "@/types/events";

export const DEFAULT_TEMPLATES: Record<EventType, string> = {
  skip: "⚠️ {validator_name} ({validator_id}) skipped a slot at block {block_number}",
  offline:
    "🔴 {validator_name} ({validator_id}) appears OFFLINE - {consecutive_skips} consecutive skips",
  recovered: "✅ {validator_name} ({validator_id}) recovered and is producing blocks again",
  delegate: "📥 +{amount_tia} TIA delegated to {validator_name} by {delegator}",
  undelegate: "📤 {amount_tia} TIA undelegated from {validator_name} by {delegator}",
  commission_changed:
    "💰 {validator_name} commission changed: {old_commission} → {new_commission}",
};

/** Human-readable per-event sentence used in Discord titles + `{event_label}`. */
export const EVENT_LABELS: Record<EventType, string> = {
  skip: "Slot Skipped",
  offline: "Validator Offline",
  recovered: "Validator Recovered",
  delegate: "New Delegation",
  undelegate: "Undelegation",
  commission_changed: "Commission Changed",
};

/**
 * Default Discord embed titles. Other adapters ignore these.
 * Users override per-event in channel config; falls back here.
 */
export const DEFAULT_TITLE_TEMPLATES: Record<EventType, string> = {
  skip: "{validator_name} — {event_label}",
  offline: "{validator_name} — {event_label}",
  recovered: "{validator_name} — {event_label}",
  delegate: "{validator_name} — {event_label}",
  undelegate: "{validator_name} — {event_label}",
  commission_changed: "{validator_name} — {event_label}",
};

/**
 * Default email subject lines. The email adapter consumes these; other
 * adapters ignore them. Users override per-event in channel config.
 */
export const DEFAULT_SUBJECT_TEMPLATES: Record<EventType, string> = {
  skip: "[Nova] {validator_name} skipped a slot",
  offline: "[Nova] {validator_name} is offline",
  recovered: "[Nova] {validator_name} recovered",
  delegate: "[Nova] {validator_name} — new delegation",
  undelegate: "[Nova] {validator_name} — undelegation",
  commission_changed: "[Nova] {validator_name} commission changed",
};
