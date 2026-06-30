import { PLACEHOLDER_SCHEMA } from "@/channels/templates/schema";
import type { EventType } from "@/types/events";

const PLACEHOLDER_RE = /\{([a-zA-Z0-9_]+)\}/g;

export interface TemplateValidationResult {
  ok: boolean;
  /** Names that are not in the schema for this event type. */
  unknown: string[];
  /** All placeholder names referenced (for UX hints). */
  used: string[];
}

/**
 * Scan a template for `{placeholder}` tokens and verify each one is in
 * the allowed catalog for the given event type. Used by the editor on
 * blur to surface inline errors. Pure, no I/O.
 */
export function validateTemplate(
  tmpl: string,
  event: EventType,
): TemplateValidationResult {
  const allowed = new Set(PLACEHOLDER_SCHEMA[event]);
  const used = new Set<string>();
  const unknown = new Set<string>();
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(tmpl)) !== null) {
    const name = m[1] ?? "";
    used.add(name);
    if (!allowed.has(name)) unknown.add(name);
  }
  return {
    ok: unknown.size === 0,
    unknown: Array.from(unknown),
    used: Array.from(used),
  };
}

/**
 * Local renderer for the live preview pane. Mirrors the worker's
 * substitution semantics (unknown -> empty string) but never throws -
 * the channels-dev `render` is the source of truth at runtime.
 */
export function previewRender(
  tmpl: string,
  vars: Record<string, string | undefined>,
): string {
  return tmpl.replace(PLACEHOLDER_RE, (_, name: string) => vars[name] ?? "");
}
