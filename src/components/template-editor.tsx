"use client";

import * as React from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TemplatePreview } from "@/components/template-preview";
import { PLACEHOLDER_SCHEMA } from "@/channels/templates/schema";
import { validateTemplate } from "@/lib/template-validation";
import type { ChannelType } from "@/types/channels";
import type { EventType } from "@/types/events";

interface TitleField {
  value: string;
  defaultValue: string;
  onChange: (next: string) => void;
  /** Label shown above the field. Defaults to "Title" (used by Discord titles). */
  label?: string;
}

interface TemplateEditorProps {
  eventType: EventType;
  channelType: ChannelType;
  value: string;
  defaultValue: string;
  onChange: (next: string) => void;
  /** Optional separate title editor. Currently only Discord wires this. */
  title?: TitleField;
}

/**
 * Per-event-type template editor. Monospace textarea + insert-placeholder
 * dropdown + reset-to-default + live preview. Validates on blur using the
 * locked schema in `src/channels/templates/schema.ts`.
 */
export function TemplateEditor({
  eventType,
  channelType,
  value,
  defaultValue,
  onChange,
  title,
}: TemplateEditorProps): JSX.Element {
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);
  const titleRef = React.useRef<HTMLInputElement | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [titleError, setTitleError] = React.useState<string | null>(null);
  // Track which field was last focused so the placeholder list inserts
  // into the right one. Defaults to body.
  const focusTargetRef = React.useRef<"body" | "title">("body");

  const placeholders = PLACEHOLDER_SCHEMA[eventType];
  const MAX_LEN = 500;
  const TITLE_MAX_LEN = 256;
  const overLimit = value.length > MAX_LEN;
  const titleOverLimit = (title?.value.length ?? 0) > TITLE_MAX_LEN;

  const insertAtCursor = React.useCallback(
    (token: string) => {
      if (focusTargetRef.current === "title" && title) {
        const el = titleRef.current;
        if (!el) {
          title.onChange(`${title.value}${token}`);
          return;
        }
        const start = el.selectionStart ?? title.value.length;
        const end = el.selectionEnd ?? title.value.length;
        const next = `${title.value.slice(0, start)}${token}${title.value.slice(end)}`;
        title.onChange(next);
        requestAnimationFrame(() => {
          const t = titleRef.current;
          if (!t) return;
          const pos = start + token.length;
          t.focus();
          t.setSelectionRange(pos, pos);
        });
        return;
      }
      const ta = taRef.current;
      if (!ta) {
        onChange(`${value}${token}`);
        return;
      }
      const start = ta.selectionStart ?? value.length;
      const end = ta.selectionEnd ?? value.length;
      const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
      onChange(next);
      // Restore caret after React reconciles.
      requestAnimationFrame(() => {
        const t = taRef.current;
        if (!t) return;
        const pos = start + token.length;
        t.focus();
        t.setSelectionRange(pos, pos);
      });
    },
    [onChange, value, title],
  );

  const handleBlur = React.useCallback(() => {
    const result = validateTemplate(value, eventType);
    if (!result.ok) {
      setError(`Unknown placeholder${result.unknown.length > 1 ? "s" : ""}: ${result.unknown
        .map((n) => `{${n}}`)
        .join(", ")}`);
    } else {
      setError(null);
    }
  }, [value, eventType]);

  const handleTitleBlur = React.useCallback(() => {
    if (!title) return;
    const result = validateTemplate(title.value, eventType);
    if (!result.ok) {
      setTitleError(
        `Unknown placeholder${result.unknown.length > 1 ? "s" : ""}: ${result.unknown
          .map((n) => `{${n}}`)
          .join(", ")}`,
      );
    } else {
      setTitleError(null);
    }
  }, [title, eventType]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange(defaultValue);
            setError(null);
            if (title) {
              title.onChange(title.defaultValue);
              setTitleError(null);
            }
          }}
        >
          Reset to default
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_240px]">
        <div className="space-y-2">
          {title ? (
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {title.label ?? "Title"}
              </label>
              <Input
                ref={titleRef}
                value={title.value}
                onChange={(e) =>
                  title.onChange(e.target.value.slice(0, TITLE_MAX_LEN))
                }
                onFocus={() => {
                  focusTargetRef.current = "title";
                }}
                onBlur={handleTitleBlur}
                maxLength={TITLE_MAX_LEN}
                spellCheck={false}
                className="font-mono text-xs"
                aria-invalid={titleError || titleOverLimit ? true : undefined}
              />
              <div className="flex items-center justify-between text-xs">
                {titleError ? (
                  <p className="text-destructive">{titleError}</p>
                ) : (
                  <span />
                )}
                <span
                  className={
                    titleOverLimit
                      ? "text-destructive"
                      : title.value.length > TITLE_MAX_LEN - 30
                        ? "text-amber-600"
                        : "text-muted-foreground"
                  }
                >
                  {title.value.length}/{TITLE_MAX_LEN}
                </span>
              </div>
            </div>
          ) : null}
          {title ? (
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Body
            </label>
          ) : null}
          <Textarea
            ref={taRef}
            value={value}
            onChange={(e) => onChange(e.target.value.slice(0, MAX_LEN))}
            onFocus={() => {
              focusTargetRef.current = "body";
            }}
            onBlur={handleBlur}
            rows={5}
            maxLength={MAX_LEN}
            spellCheck={false}
            className="font-mono text-xs leading-relaxed"
            aria-invalid={error || overLimit ? true : undefined}
          />
          <div className="flex items-center justify-between text-xs">
            {error ? (
              <p className="text-destructive">{error}</p>
            ) : (
              <span />
            )}
            <span
              className={
                overLimit
                  ? "text-destructive"
                  : value.length > MAX_LEN - 50
                    ? "text-amber-600"
                    : "text-muted-foreground"
              }
            >
              {value.length}/{MAX_LEN}
            </span>
          </div>
          <TemplatePreview
            template={value || defaultValue}
            eventType={eventType}
            channelType={channelType}
            title={
              title
                ? title.value || title.defaultValue
                : undefined
            }
          />
        </div>

        <PlaceholderList
          placeholders={placeholders}
          onInsert={(p) => insertAtCursor(`{${p}}`)}
        />
      </div>
    </div>
  );
}

function PlaceholderList({
  placeholders,
  onInsert,
}: {
  placeholders: readonly string[];
  onInsert: (key: string) => void;
}): JSX.Element {
  const [copied, setCopied] = React.useState<string | null>(null);

  async function copy(
    key: string,
    e: React.MouseEvent<HTMLButtonElement>,
  ): Promise<void> {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(`{${key}}`);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <aside className="rounded-md border bg-card">
      <div className="border-b px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Placeholders
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Click to insert at cursor.
        </p>
      </div>
      <ul
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "rgb(var(--foreground-rgb, 255 255 255) / 0.2) transparent",
        }}
        className="max-h-64 overflow-y-auto p-1 md:max-h-[18rem] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-foreground/20 [&::-webkit-scrollbar-track]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-foreground/30"
      >
        {placeholders.map((p) => (
          <li key={p} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onInsert(p)}
              className="flex-1 truncate rounded px-2 py-1.5 text-left font-mono text-xs hover:bg-foreground/[0.04]"
            >
              {`{${p}}`}
            </button>
            <button
              type="button"
              onClick={(e) => copy(p, e)}
              aria-label={`Copy {${p}}`}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
            >
              {copied === p ? (
                <span className="text-[10px] font-semibold text-emerald-500">
                  OK
                </span>
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
