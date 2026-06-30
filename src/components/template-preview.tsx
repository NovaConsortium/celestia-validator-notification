"use client";

import * as React from "react";
import type { ChannelType } from "@/types/channels";
import type { EventType } from "@/types/events";
import { buildSampleVars } from "@/lib/sample-event";
import { previewRender } from "@/lib/template-validation";
import { cn } from "@/lib/utils";

interface TemplatePreviewProps {
  template: string;
  eventType: EventType;
  channelType: ChannelType;
  /** Discord-only embed title template; rendered with the same sample vars. */
  title?: string;
}

/**
 * Renders the template using mocked sample data, then displays it in a
 * channel-specific mockup so the user sees roughly what their alert will
 * look like in the destination app. Pure client component, no API calls.
 */
export function TemplatePreview({
  template,
  eventType,
  channelType,
  title,
}: TemplatePreviewProps): JSX.Element {
  const vars = React.useMemo(() => buildSampleVars(eventType), [eventType]);
  const rendered = React.useMemo(
    () => previewRender(template, vars),
    [template, vars],
  );
  const renderedTitle = React.useMemo(
    () => (title ? previewRender(title, vars) : ""),
    [title, vars],
  );

  return (
    <div className="rounded-md border border-dashed border-border bg-muted/40 p-3">
      <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        Preview · {channelType}
      </p>
      <ChannelMockup
        channel={channelType}
        text={rendered}
        title={renderedTitle}
        severity={vars.severity ?? "info"}
      />
    </div>
  );
}

function severityBorder(severity: string): string {
  switch (severity) {
    case "critical":
      return "border-l-red-500";
    case "warning":
      return "border-l-yellow-500";
    default:
      return "border-l-blue-500";
  }
}

function ChannelMockup({
  channel,
  text,
  title,
  severity,
}: {
  channel: ChannelType;
  text: string;
  title: string;
  severity: string;
}): JSX.Element {
  switch (channel) {
    case "discord":
      return (
        <div
          className={cn(
            "rounded-md border-l-4 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 shadow-inner",
            severityBorder(severity),
          )}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              {title ? (
                <p className="break-words text-sm font-semibold text-zinc-100">
                  {title}
                </p>
              ) : null}
              <p className="whitespace-pre-wrap break-words text-zinc-200">
                {text || "-"}
              </p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/nova.png"
              alt=""
              className="h-12 w-12 shrink-0 rounded bg-zinc-800 object-contain ring-1 ring-zinc-700"
            />
          </div>
        </div>
      );
    case "slack":
      return (
        <div
          className={cn(
            "rounded-md border-l-4 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm",
            severityBorder(severity),
          )}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              {title ? (
                <p className="break-words text-sm font-bold text-zinc-900">
                  {title}
                </p>
              ) : null}
              <p className="whitespace-pre-wrap break-words text-zinc-700">
                {text || "-"}
              </p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/nova.png"
              alt=""
              className="h-12 w-12 shrink-0 rounded bg-zinc-100 object-contain ring-1 ring-zinc-200"
            />
          </div>
        </div>
      );
    case "telegram":
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] overflow-hidden rounded-2xl bg-sky-100 text-sm text-zinc-900 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/nova.png"
              alt=""
              className="aspect-[16/9] w-full bg-sky-200 object-contain"
            />
            <div className="space-y-1 px-3 py-2">
              {title ? (
                <p className="break-words text-sm font-bold">{title}</p>
              ) : null}
              <p className="whitespace-pre-wrap break-words">{text || "-"}</p>
              <p className="pt-1 text-xs text-sky-700 underline">Open dashboard</p>
            </div>
          </div>
        </div>
      );
    case "pagerduty":
      return (
        <div
          className={cn(
            "rounded-md border-l-4 bg-zinc-50 px-3 py-2 text-sm text-zinc-900",
            severityBorder(severity),
          )}
        >
          <p className="text-xs font-semibold uppercase text-zinc-500">
            Incident · {severity}
          </p>
          <p className="whitespace-pre-wrap break-words font-medium">{text || "-"}</p>
        </div>
      );
    case "email":
      return (
        <div
          className={cn(
            "rounded-md border-l-4 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm",
            severityBorder(severity),
          )}
        >
          {title ? (
            <p className="mb-1 break-words text-sm font-semibold text-zinc-900">
              {title}
            </p>
          ) : null}
          <p className="whitespace-pre-wrap break-words text-zinc-700">
            {text || "-"}
          </p>
        </div>
      );
  }
}
