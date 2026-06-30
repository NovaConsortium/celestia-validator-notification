"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertConfigForm, DEFAULT_ALERT_CONFIG } from "@/components/alert-config-form";
import { Captcha } from "@/components/captcha";
import { ChannelCard, CHANNEL_PALETTE, newChannel } from "@/components/channel-card";
import { ConnectDialog } from "@/components/wallet/connect-dialog";
import { useWalletSession } from "@/components/wallet/wallet-session-context";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type {
  AlertConfig,
  ChannelInput,
  CreateSubscriptionResponse,
  SubscriptionResponse,
} from "@/lib/api-types";
import {
  ALL_EVENT_GROUPS,
  type ChannelConfig,
  type ChannelType,
  type EventGroupKey,
} from "@/types/channels";
import type { Network } from "@/types/events";

interface RevealableChannelSecrets {
  webhookUrl?: string;
  routingKey?: string;
}

interface ChannelEntry {
  /** Stable client-side identity so add/remove/exit animations don't get
   *  confused when array indices shift. Mirrors `channel.id` for saved rows. */
  key: string;
  channel: ChannelInput;
}

// Must match the collapse-row animation duration in globals.css.
const EXIT_ANIM_MS = 280;

function genEntryKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

function channelsEqual(a: ChannelInput[], b: ChannelInput[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ca = a[i];
    const cb = b[i];
    if (ca.id !== cb.id || ca.type !== cb.type || ca.enabled !== cb.enabled) {
      return false;
    }
    const ea = [...(ca.events ?? [])].sort();
    const eb = [...(cb.events ?? [])].sort();
    if (stableStringify(ea) !== stableStringify(eb)) return false;
    if (stableStringify(ca.config ?? {}) !== stableStringify(cb.config ?? {})) {
      return false;
    }
  }
  return true;
}

function buildChannelEntries(
  channels: SubscriptionResponse["channels"] | undefined,
  revealable: Record<string, RevealableChannelSecrets> | undefined,
): ChannelEntry[] {
  return (channels ?? []).map((c) => {
    const raw = { ...(c.config as Record<string, unknown>) };
    delete raw.webhookUrlSet;
    delete raw.routingKeySet;
    const cfg = raw as ChannelConfig;
    const reveal = revealable?.[c.id];
    if (reveal?.webhookUrl) cfg.webhookUrl = reveal.webhookUrl;
    if (reveal?.routingKey) cfg.routingKey = reveal.routingKey;
    return {
      key: c.id ?? genEntryKey(),
      channel: {
        id: c.id,
        type: c.type,
        enabled: c.enabled,
        config: cfg,
        events:
          c.events && c.events.length >= 0 ? c.events : [...ALL_EVENT_GROUPS],
      },
    };
  });
}

interface SubscriptionFormProps {
  validatorId: string;
  network: Network;
  /** When present, runs in edit mode and PATCHes by subscription id instead of POSTing. */
  initial?: SubscriptionResponse;
  subscriptionId?: string;
  /** Owner-only plaintext for webhook url / routing key, keyed by channel id. */
  revealableSecrets?: Record<string, RevealableChannelSecrets>;
  onSaved?: (res: CreateSubscriptionResponse | SubscriptionResponse) => void;
  /** Optional action rendered inline next to the Save / Create button. */
  extraAction?: React.ReactNode;
}

export function SubscriptionForm({
  validatorId,
  network,
  initial,
  subscriptionId,
  revealableSecrets,
  onSaved,
  extraAction,
}: SubscriptionFormProps): JSX.Element {
  const router = useRouter();
  const isEdit = Boolean(subscriptionId);
  const { address } = useWalletSession();
  const [walletDialogOpen, setWalletDialogOpen] = React.useState(false);

  const [alertConfig, setAlertConfig] = React.useState<AlertConfig>(
    initial?.alertConfig ?? DEFAULT_ALERT_CONFIG,
  );
  const [entries, setEntries] = React.useState<ChannelEntry[]>(() =>
    buildChannelEntries(initial?.channels, revealableSecrets),
  );
  const [exitingKeys, setExitingKeys] = React.useState<Set<string>>(
    () => new Set(),
  );
  const channels = React.useMemo(() => entries.map((e) => e.channel), [entries]);
  const liveChannels = React.useMemo(
    () =>
      entries.filter((e) => !exitingKeys.has(e.key)).map((e) => e.channel),
    [entries, exitingKeys],
  );
  // Track which Telegram channels are already paired (only `ChannelOutput.paired`
  // tells us this - `channel.id` alone is not proof of pairing).
  const pairedById = React.useMemo(() => {
    const m = new Map<string, boolean>();
    for (const c of initial?.channels ?? []) m.set(c.id, Boolean(c.paired));
    return m;
  }, [initial]);
  const [customRpcUrl, setCustomRpcUrl] = React.useState(
    initial?.customRpcUrl ?? "",
  );
  const [customRpcRole, setCustomRpcRole] = React.useState<"primary" | "fallback">(
    (initial?.customRpcRole as "primary" | "fallback" | undefined) ?? "fallback",
  );
  const [captchaToken, setCaptchaToken] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Snapshot of last-saved form state, used in edit mode to disable
  // "Save changes" until something actually differs. Refreshed after
  // every successful save so the button re-disables once changes land.
  const [savedSnapshot, setSavedSnapshot] = React.useState<{
    alertConfig: AlertConfig;
    channels: ChannelInput[];
    customRpcUrl: string;
    customRpcRole: "primary" | "fallback";
  } | null>(() =>
    isEdit
      ? {
          alertConfig: initial?.alertConfig ?? DEFAULT_ALERT_CONFIG,
          channels: buildChannelEntries(
            initial?.channels,
            revealableSecrets,
          ).map((e) => e.channel),
          customRpcUrl: initial?.customRpcUrl ?? "",
          customRpcRole:
            (initial?.customRpcRole as "primary" | "fallback" | undefined) ??
            "fallback",
        }
      : null,
  );

  const channelListRef = React.useRef<HTMLDivElement | null>(null);
  const prevLiveCount = React.useRef(liveChannels.length);
  React.useEffect(() => {
    if (liveChannels.length > prevLiveCount.current && channelListRef.current) {
      const last = channelListRef.current.lastElementChild as HTMLElement | null;
      last?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    prevLiveCount.current = liveChannels.length;
  }, [liveChannels.length]);

  function addChannel(type: ChannelType): void {
    setEntries((es) => [
      ...es,
      { key: genEntryKey(), channel: newChannel(type) },
    ]);
  }

  function scheduleExit(keys: string[]): void {
    if (keys.length === 0) return;
    setExitingKeys((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
    const finalize = (): void => {
      setEntries((es) => es.filter((e) => !keys.includes(e.key)));
      setExitingKeys((prev) => {
        const next = new Set(prev);
        for (const k of keys) next.delete(k);
        return next;
      });
    };
    if (typeof window === "undefined") {
      finalize();
      return;
    }
    window.setTimeout(finalize, EXIT_ANIM_MS);
  }

  function removeChannelsByType(type: ChannelType): void {
    const keys = entries
      .filter((e) => e.channel.type === type && !exitingKeys.has(e.key))
      .map((e) => e.key);
    scheduleExit(keys);
  }

  function patchChannel(idx: number, next: ChannelInput): void {
    setEntries((es) =>
      es.map((e, i) => (i === idx ? { ...e, channel: next } : e)),
    );
  }

  function removeChannel(idx: number): void {
    const target = entries[idx];
    if (!target || exitingKeys.has(target.key)) return;
    scheduleExit([target.key]);
  }

  function patchChannelEvents(
    channelIdx: number,
    group: EventGroupKey,
    on: boolean,
  ): void {
    setEntries((es) =>
      es.map((e, i) => {
        if (i !== channelIdx) return e;
        const c = e.channel;
        const current = c.events ?? [...ALL_EVENT_GROUPS];
        const has = current.includes(group);
        if (on === has) return e;
        const nextEvents = on
          ? [...current, group]
          : current.filter((g) => g !== group);
        return { ...e, channel: { ...c, events: nextEvents } };
      }),
    );
  }

  const walletReady = isEdit || Boolean(address);
  const isDirty = React.useMemo(() => {
    if (!isEdit || !savedSnapshot) return true;
    if (
      stableStringify(alertConfig) !==
      stableStringify(savedSnapshot.alertConfig)
    ) {
      return true;
    }
    if ((customRpcUrl || "") !== (savedSnapshot.customRpcUrl || "")) {
      return true;
    }
    if (customRpcUrl && customRpcRole !== savedSnapshot.customRpcRole) {
      return true;
    }
    if (!channelsEqual(liveChannels, savedSnapshot.channels)) return true;
    return false;
  }, [
    isEdit,
    savedSnapshot,
    alertConfig,
    customRpcUrl,
    customRpcRole,
    liveChannels,
  ]);
  const canSubmit =
    liveChannels.length > 0 &&
    walletReady &&
    (isEdit || captchaToken !== null) &&
    (!isEdit || isDirty) &&
    !submitting;

  async function submit(): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      if (isEdit && subscriptionId) {
        const res = await apiClient.updateSubscription(subscriptionId, {
          alertConfig,
          channels: liveChannels,
          customRpcUrl: customRpcUrl || null,
          customRpcRole: customRpcUrl ? customRpcRole : null,
        });
        setSavedSnapshot({
          alertConfig,
          channels: liveChannels,
          customRpcUrl,
          customRpcRole,
        });
        onSaved?.(res);
      } else {
        const res = await apiClient.createSubscription({
          validatorId,
          network,
          alertConfig,
          channels: liveChannels,
          customRpcUrl: customRpcUrl || undefined,
          customRpcRole: customRpcUrl ? customRpcRole : undefined,
          hcaptchaToken: captchaToken ?? "dev-captcha-disabled",
        });
        onSaved?.(res);
        router.push(`/manage/${encodeURIComponent(res.subscriptionId)}?created=1`);
      }
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to save";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-10">
      <Section step={1} title="What alerts do you want?" delay={60}>
        <AlertConfigForm
          value={alertConfig}
          onChange={setAlertConfig}
          channels={channels}
          onChannelEventsChange={patchChannelEvents}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          {channels.length > 0
            ? "Each enabled alert routes to every channel by default — use the chips to narrow it down."
            : "Add channels below, then choose which alerts each one receives."}
        </p>
      </Section>

      <Section step={2} title="Where should alerts go?" delay={160}>
        <ChannelPalette
          existing={liveChannels.map((c) => c.type)}
          onAdd={addChannel}
          onRemoveAll={removeChannelsByType}
        />
        {entries.length === 0 ? (
          <p className="mt-6 animate-fade-in rounded-xl border border-dashed border-border px-6 py-7 text-center text-sm text-muted-foreground">
            Pick at least one channel above to start receiving alerts.
          </p>
        ) : (
          <div ref={channelListRef} className="mt-8 space-y-4">
            {entries.map((e, i) => {
              const exiting = exitingKeys.has(e.key);
              return (
                <div
                  key={e.key}
                  className={cn(
                    exiting ? "expand-row-exit" : "expand-row-enter",
                  )}
                  style={
                    exiting ? undefined : { animationDelay: `${i * 60}ms` }
                  }
                  aria-hidden={exiting || undefined}
                >
                  <div className="expand-row-inner">
                    <div className={cn(!exiting && "animate-fade-up")}>
                      <ChannelCard
                        channel={e.channel}
                        paired={e.channel.id ? pairedById.get(e.channel.id) : false}
                        subscriptionId={subscriptionId}
                        onChange={(next) => patchChannel(i, next)}
                        onRemove={() => removeChannel(i)}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <details className="group panel overflow-hidden rounded-2xl">
        <summary className="flex cursor-pointer items-center justify-between gap-2 px-5 py-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <span>Advanced</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-6 border-t border-border px-5 py-5">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Custom RPC URL (optional)</span>
            <Input
              type="url"
              placeholder="https://your-rpc.example/…"
              value={customRpcUrl}
              onChange={(e) => setCustomRpcUrl(e.target.value)}
            />
          </label>
          {customRpcUrl ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium">Role</p>
              <Select
                value={customRpcRole}
                onValueChange={(v) =>
                  setCustomRpcRole(v as "primary" | "fallback")
                }
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="primary">Primary</SelectItem>
                  <SelectItem value="fallback">Fallback</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Primary = your RPC is queried first. Fallback = public pool first,
                yours only if those fail.
              </p>
            </div>
          ) : null}
        </div>
      </details>

      {!isEdit ? (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-micro text-muted-foreground">
            Verify you&apos;re human
          </p>
          <Captcha
            onVerify={setCaptchaToken}
            onExpire={() => setCaptchaToken(null)}
          />
        </div>
      ) : null}

      {error ? (
        <p className="animate-shake rounded-xl border border-destructive bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {!isEdit && !address ? (
        <div className="panel rounded-2xl border-primary/30 p-5 ring-violet">
          <p className="text-sm font-semibold">Connect your wallet to save</p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Alerts are tied to your wallet so you can manage them from any device
            at <span className="font-mono text-foreground/80">/my-alerts</span>.
            It&rsquo;s an off-chain signature — no transaction, no funds move.
          </p>
          <Button type="button" size="sm" className="mt-3.5" onClick={() => setWalletDialogOpen(true)}>
            Connect Wallet
          </Button>
          <ConnectDialog open={walletDialogOpen} onOpenChange={setWalletDialogOpen} />
        </div>
      ) : null}

      <div className="flex flex-wrap justify-center gap-3 md:justify-end">
        <Button type="button" disabled={!canSubmit} onClick={submit} size="lg">
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {isEdit ? "Save changes" : "Create subscription"}
        </Button>
        {extraAction}
      </div>
    </div>
  );
}

function Section({
  step,
  title,
  children,
  delay = 0,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
  delay?: number;
}): JSX.Element {
  return (
    <section className="animate-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <div className="mb-4 flex items-center gap-3">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/12 font-mono text-xs font-semibold text-primary ring-1 ring-inset ring-primary/25">
          {step}
        </span>
        <h2 className="text-base font-semibold tracking-editorial">{title}</h2>
      </div>
      {children}
    </section>
  );
}

const CHANNEL_CAPS: Record<ChannelType, number> = {
  discord: 1,
  slack: 1,
  telegram: 1,
  pagerduty: 1,
  email: 1,
};


function ChannelPalette({
  existing,
  onAdd,
  onRemoveAll,
}: {
  existing: ChannelType[];
  onAdd: (t: ChannelType) => void;
  onRemoveAll: (t: ChannelType) => void;
}): JSX.Element {
  const counts = existing.reduce(
    (acc, t) => {
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    },
    {} as Partial<Record<ChannelType, number>>,
  );

  return (
    <div className="flex flex-wrap gap-2.5">
      {CHANNEL_PALETTE.map((p) => {
        const count = counts[p.type] ?? 0;
        const atCap = count >= CHANNEL_CAPS[p.type];
        const active = count > 0;
        const clickable = (count === 0 && !atCap) || active;

        return (
          <button
            key={p.type}
            type="button"
            onClick={() => {
              if (active) onRemoveAll(p.type);
              else if (!atCap) onAdd(p.type);
            }}
            disabled={!clickable}
            aria-pressed={active}
            aria-label={active ? `Remove ${p.label}` : `Add ${p.label}`}
            title={active ? `Click to remove ${p.label}` : `${p.label} · ${p.hint}`}
            style={
              active
                ? { borderColor: p.color, backgroundColor: `${p.color}1a` }
                : undefined
            }
            className={cn(
              "group inline-flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 transition-all duration-200 ease-out-quint",
              clickable && "cursor-pointer active:scale-[0.97]",
              !active && clickable && "border-border hover:-translate-y-0.5 hover:border-foreground/30 hover:bg-foreground/[0.03]",
              !clickable && "cursor-not-allowed opacity-40",
            )}
          >
            <span
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center transition-transform duration-200 group-hover:scale-110",
                active && "animate-pop",
              )}
            >
              {p.iconSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.iconSrc} alt="" width={22} height={22} className="h-[22px] w-[22px] object-contain" />
              ) : p.Icon ? (
                <p.Icon className="h-5 w-5" style={{ color: p.color }} />
              ) : null}
            </span>
            <span className="flex items-center leading-none">
              <span className="text-sm font-semibold" style={active ? { color: p.color } : undefined}>
                {p.label}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
