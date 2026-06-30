"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  Coins,
  Mail,
  Percent,
  SkipForward,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { AlertConfig, ChannelInput } from "@/lib/api-types";
import {
  ALL_EVENT_GROUPS,
  isChannelGroupAllowed,
  type ChannelType,
  type EventGroupKey,
} from "@/types/channels";

interface AlertConfigFormProps {
  value: AlertConfig;
  onChange: (next: AlertConfig) => void;
  /** Channels currently configured (drives the per-alert routing chips). */
  channels?: ChannelInput[];
  /** Toggle a channel's membership in `group`. */
  onChannelEventsChange?: (
    channelIdx: number,
    group: EventGroupKey,
    on: boolean,
  ) => void;
}

interface ToggleDef {
  key: EventGroupKey;
  label: string;
  hint: string;
  Icon: LucideIcon;
  color: string;
}

const TOGGLES: ToggleDef[] = [
  {
    key: "slotSkip",
    label: "Missed block",
    hint: "Every block your validator fails to sign.",
    Icon: SkipForward,
    color: "#F59E0B",
  },
  {
    key: "offline",
    label: "Offline & recovery",
    hint: "N consecutive misses, plus the all-clear.",
    Icon: WifiOff,
    color: "#EF4444",
  },
  {
    key: "delegation",
    label: "Delegation",
    hint: "Delegations & undelegations to your validator.",
    Icon: Coins,
    color: "#10B981",
  },
  {
    key: "commission",
    label: "Commission",
    hint: "When the validator changes its commission rate.",
    Icon: Percent,
    color: "#A855F7",
  },
];

const CHANNEL_ICONS: Record<
  ChannelType,
  { label: string; color: string; iconSrc?: string; Icon?: LucideIcon }
> = {
  discord: { label: "Discord", color: "#5865F2", iconSrc: "/discord-icon.png" },
  slack: { label: "Slack", color: "#E01E5A", iconSrc: "/slack-icon.png" },
  telegram: { label: "Telegram", color: "#229ED9", iconSrc: "/telegram-icon.png" },
  pagerduty: { label: "PagerDuty", color: "#06AC38", iconSrc: "/pagerduty-icon.webp" },
  email: { label: "Email", color: "#F59E0B", Icon: Mail },
};

export function AlertConfigForm({
  value,
  onChange,
  channels,
  onChannelEventsChange,
}: AlertConfigFormProps): JSX.Element {
  function patch<K extends keyof AlertConfig>(k: K, v: AlertConfig[K]): void {
    onChange({ ...value, [k]: v });
  }

  const showRouting = Boolean(channels && channels.length > 0 && onChannelEventsChange);

  return (
    <div className="panel divide-y divide-border overflow-hidden rounded-2xl">
      {TOGGLES.map((t) => {
        const checked = t.key === "offline" ? value.offline !== false : Boolean(value[t.key]);
        const extra =
          t.key === "offline" || t.key === "delegation" || showRouting;

        return (
          <div key={t.key} className="px-4 py-3.5 md:px-5">
            <div className="flex items-center gap-3.5">
              <span
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset"
                style={{
                  backgroundColor: `${t.color}1f`,
                  color: t.color,
                  // ring uses the same hue at low alpha
                  boxShadow: `inset 0 0 0 1px ${t.color}40`,
                }}
              >
                <t.Icon className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight">{t.label}</p>
                <p className="text-xs leading-snug text-muted-foreground">{t.hint}</p>
              </div>
              <Switch
                checked={checked}
                onCheckedChange={(on) => patch(t.key, on as AlertConfig[typeof t.key])}
                aria-label={t.label}
              />
            </div>

            {/* Progressive disclosure: thresholds + routing, only when on. */}
            <div
              className={cn(
                "grid transition-[grid-template-rows,opacity] duration-300 ease-out-quint",
                checked && extra
                  ? "mt-0 grid-rows-[1fr] opacity-100"
                  : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="space-y-3 pl-[3.25rem] pt-3">
                  {t.key === "offline" && checked ? (
                    <Field label="Offline after (consecutive misses)" hint="Default 5 · range 2–50.">
                      <OfflineThresholdInput
                        value={value.offlineAfterN}
                        onCommit={(n) => patch("offlineAfterN", n)}
                      />
                    </Field>
                  ) : null}

                  {t.key === "delegation" && checked ? (
                    <Field
                      label="Minimum amount (TIA)"
                      hint="Ignore delegations smaller than this. Blank = all."
                    >
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        placeholder="0"
                        className="h-9 max-w-[180px]"
                        value={value.delegationMinTia ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === "") {
                            const next = { ...value };
                            delete next.delegationMinTia;
                            onChange(next);
                            return;
                          }
                          const n = Number(raw);
                          if (Number.isFinite(n) && n >= 0) patch("delegationMinTia", n);
                        }}
                      />
                    </Field>
                  ) : null}

                  {showRouting && checked ? (
                    <ChannelRoutingRow
                      group={t.key}
                      groupColor={t.color}
                      channels={channels ?? []}
                      onToggle={(idx, on) => onChannelEventsChange?.(idx, t.key, on)}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-foreground/80">{label}</p>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Compact, selectable channel chips controlling routing for one alert group. */
function ChannelRoutingRow({
  group,
  groupColor,
  channels,
  onToggle,
}: {
  group: EventGroupKey;
  groupColor: string;
  channels: ChannelInput[];
  onToggle: (channelIdx: number, on: boolean) => void;
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] uppercase tracking-micro text-muted-foreground">
        Route to
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {channels.map((ch, idx) => {
          const meta = CHANNEL_ICONS[ch.type];
          const events = ch.events ?? [...ALL_EVENT_GROUPS];
          const allowed = isChannelGroupAllowed(ch.type, group);
          const routed = allowed && events.includes(group);
          const blockedTitle = `Due to high volume, ${meta.label} can't take this alert.`;
          return (
            <ChannelChip
              key={`${ch.id ?? "new"}-${idx}`}
              tooltip={!allowed ? blockedTitle : undefined}
              onClick={() => {
                if (!allowed) return;
                onToggle(idx, !routed);
              }}
              aria-pressed={routed}
              aria-disabled={!allowed || undefined}
              aria-label={`${routed ? "Stop routing" : "Route"} ${meta.label}`}
              style={
                routed
                  ? { borderColor: groupColor, backgroundColor: `${groupColor}1f`, color: groupColor }
                  : undefined
              }
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-200",
                routed
                  ? "shadow-[0_0_0_1px_currentColor_inset]"
                  : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                !allowed && "cursor-not-allowed border-dashed opacity-40",
              )}
            >
              {meta.iconSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={meta.iconSrc} alt="" width={14} height={14} className="h-3.5 w-3.5 object-contain" />
              ) : meta.Icon ? (
                <meta.Icon className="h-3.5 w-3.5" />
              ) : null}
              {meta.label}
            </ChannelChip>
          );
        })}
      </div>
    </div>
  );
}

function ChannelChip({
  tooltip,
  children,
  ...buttonProps
}: {
  tooltip?: string;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const ref = React.useRef<HTMLButtonElement>(null);
  const [hover, setHover] = React.useState(false);
  const [pos, setPos] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const updatePos = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: r.left + r.width / 2, y: r.top });
  }, []);

  const show = (): void => {
    if (!tooltip) return;
    updatePos();
    setHover(true);
  };
  const hide = (): void => setHover(false);

  return (
    <>
      <button
        ref={ref}
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        {...buttonProps}
      >
        {children}
      </button>
      {tooltip && hover && typeof document !== "undefined"
        ? createPortal(
            <span
              role="tooltip"
              style={{
                position: "fixed",
                left: pos.x,
                top: pos.y,
                transform: "translate(-50%, calc(-100% - 6px))",
              }}
              className="pointer-events-none z-[60] whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md animate-fade-in"
            >
              {tooltip}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

const OFFLINE_MIN = 2;
const OFFLINE_MAX = 50;

function OfflineThresholdInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (n: number) => void;
}): JSX.Element {
  const [draft, setDraft] = React.useState<string>(String(value));

  React.useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <Input
      type="number"
      inputMode="numeric"
      min={OFFLINE_MIN}
      max={OFFLINE_MAX}
      className="h-9 max-w-[180px]"
      value={draft}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (raw === "") return;
        const n = Number(raw);
        if (Number.isInteger(n) && n >= OFFLINE_MIN && n <= OFFLINE_MAX) onCommit(n);
      }}
      onBlur={() => {
        if (draft === "") {
          onCommit(OFFLINE_MIN);
          return;
        }
        const n = Number(draft);
        if (!Number.isFinite(n)) {
          onCommit(OFFLINE_MIN);
          return;
        }
        onCommit(Math.max(OFFLINE_MIN, Math.min(OFFLINE_MAX, Math.round(n))));
      }}
    />
  );
}

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  slotSkip: true,
  offline: true,
  delegation: true,
  commission: true,
  offlineAfterN: 5,
  delegationMinTia: 1000,
};
