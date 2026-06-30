"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Loader2, Mail, Wallet } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConnectDialog } from "@/components/wallet/connect-dialog";
import { useWalletSession } from "@/components/wallet/wallet-session-context";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  MineValidatorInfo,
  SubscriptionResponse,
} from "@/lib/api-types";
import type { ChannelType } from "@/types/channels";

export default function MyAlertsPage(): JSX.Element {
  const { address } = useWalletSession();
  const [subs, setSubs] = React.useState<SubscriptionResponse[] | null>(null);
  const [validators, setValidators] = React.useState<
    Record<string, MineValidatorInfo>
  >({});
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  React.useEffect(() => {
    if (!address) {
      setSubs(null);
      setValidators({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .getMine()
      .then((res) => {
        if (cancelled) return;
        setSubs(res.subscriptions);
        setValidators(res.validators ?? {});
      })
      .catch((err) => {
        if (cancelled) return;
        const msg =
          err instanceof ApiClientError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not load alerts";
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  return (
    <main className="relative z-10 pt-6 md:pt-8">
      <SiteHeader />
      <div className="mx-auto max-w-[1400px] px-6 pb-20 md:px-10">
      <Link
        href="/"
        className="group mb-2 mt-6 inline-flex animate-fade-down items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3 transition-transform duration-200 ease-out-quart group-hover:-translate-x-0.5" />{" "}
        Back to validators
      </Link>
      <header className="mb-6 mt-4">
        <p
          className="animate-fade-up text-2xs uppercase tracking-micro text-muted-foreground"
          style={{ animationDelay: "60ms" }}
        >
          My alerts
        </p>
        <h1
          className="mt-1 animate-fade-up text-2xl font-semibold tracking-tight"
          style={{ animationDelay: "140ms" }}
        >
          Saved alerts for your wallet
        </h1>
        <p
          className="mt-1 animate-fade-up text-sm text-muted-foreground"
          style={{ animationDelay: "220ms" }}
        >
          Anything you create while connected appears here. Linking is just a
          label, so you never sign a transaction.
        </p>
      </header>

      {!address ? (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-start gap-3">
              <Wallet className="mt-0.5 h-5 w-5 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Connect your wallet</p>
                <p className="text-sm text-muted-foreground">
                  Sign a plain off-chain message to see every alert linked to
                  your wallet, even on a new browser or device.
                </p>
              </div>
            </div>
            <Button onClick={() => setDialogOpen(true)}>Connect Wallet</Button>
            <ConnectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : subs && subs.length > 0 ? (
        <div className="space-y-3">
          {subs.map((s, i) => {
            const meta = validators[`${s.network}:${s.validatorId}`];
            const displayName =
              meta?.name ?? `Validator #${s.validatorId}`;
            return (
              <Card
                key={s.id}
                style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
                className="relative animate-fade-up transition-all duration-200 ease-out-quart hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <NetworkBadge network={s.network} />
                <CardHeader className="pb-2 pr-24">
                  <CardTitle className="flex items-center gap-3 text-base">
                    <span className="inline-flex min-w-0 flex-1 items-center gap-3">
                      <ValidatorAvatar name={displayName} logo={meta?.logo} />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{displayName}</span>
                        {meta?.name ? (
                          <span className="text-2xs font-normal uppercase tracking-micro text-muted-foreground">
                            #{s.validatorId}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="min-w-0 space-y-1 text-xs text-muted-foreground">
                    <p>
                      {s.channels.length} channel
                      {s.channels.length === 1 ? "" : "s"}
                      {" · "}
                      created {relativeTime(s.createdAt)}
                    </p>
                    <p className="truncate">
                      Alerts:{" "}
                      {alertSummary(s.alertConfig).join(", ") || "none enabled"}
                    </p>
                    <ChannelIconList channels={s.channels} />
                  </div>
                  <Link
                    href={`/manage/${encodeURIComponent(s.id)}`}
                    className="group inline-flex shrink-0 items-center gap-1.5 border border-foreground/15 bg-foreground/[0.03] px-3.5 py-2 text-xs font-semibold uppercase tracking-micro text-foreground transition-all duration-200 ease-out-quart hover:border-primary/60 hover:bg-primary/10 hover:text-primary"
                  >
                    Manage
                    <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 ease-out-quart group-hover:translate-x-0.5" />
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="space-y-3 pt-6 text-sm text-muted-foreground">
            <p>No alerts linked to this wallet yet.</p>
            <p>
              Pick a validator from the{" "}
              <Link href="/" className="underline underline-offset-2 hover:text-foreground">
                dashboard
              </Link>{" "}
              and create a subscription. It will save to your wallet
              automatically while connected.
            </p>
          </CardContent>
        </Card>
      )}
      </div>
    </main>
  );
}

function NetworkBadge({ network }: { network: string }): JSX.Element {
  const isMainnet = network === "mainnet";
  const tone = isMainnet
    ? "border-success/30 bg-success/10 text-success"
    : "border-primary/30 bg-primary/10 text-primary";
  const dot = isMainnet ? "bg-success" : "bg-primary";
  return (
    <span
      className={cn(
        "absolute right-3 top-3 inline-flex items-center gap-1.5 border px-1.5 py-0.5 text-[10px] uppercase tracking-micro",
        tone,
      )}
    >
      <span className={cn("h-1 w-1 rounded-full", dot)} />
      {network}
    </span>
  );
}

function ValidatorAvatar({
  name,
  logo,
}: {
  name: string;
  logo?: string;
}): JSX.Element {
  if (logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt=""
        width={32}
        height={32}
        className="h-8 w-8 shrink-0 rounded border border-foreground/10 bg-foreground/[0.04] object-cover"
        referrerPolicy="no-referrer"
      />
    );
  }
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className="grid h-8 w-8 shrink-0 place-items-center rounded border border-foreground/10 bg-foreground/[0.04] text-sm font-semibold text-foreground/70"
    >
      {initial}
    </span>
  );
}

const CHANNEL_ICON_SRC: Partial<Record<ChannelType, string>> = {
  discord: "/discord-icon.png",
  slack: "/slack-icon.png",
  telegram: "/telegram-icon.png",
  pagerduty: "/pagerduty-icon.webp",
};

const CHANNEL_LABEL: Record<ChannelType, string> = {
  discord: "Discord",
  slack: "Slack",
  telegram: "Telegram",
  pagerduty: "PagerDuty",
  email: "Email",
};

function ChannelIconList({
  channels,
}: {
  channels: SubscriptionResponse["channels"];
}): JSX.Element | null {
  if (channels.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 pt-0.5">
      <span>Channels:</span>
      <span className="flex items-center gap-1">
        {channels.map((c) => {
          const src = CHANNEL_ICON_SRC[c.type];
          const label = CHANNEL_LABEL[c.type];
          return (
            <span
              key={c.id}
              title={label}
              aria-label={label}
              className="grid h-5 w-5 place-items-center rounded bg-foreground/[0.06]"
            >
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt=""
                  width={14}
                  height={14}
                  className="h-3.5 w-3.5 object-contain"
                />
              ) : (
                <Mail className="h-3 w-3" />
              )}
            </span>
          );
        })}
      </span>
    </div>
  );
}

function alertSummary(cfg: SubscriptionResponse["alertConfig"]): string[] {
  const out: string[] = [];
  if (cfg.slotSkip) out.push("slot skips");
  if (cfg.offlineAfterN) out.push(`offline ≥${cfg.offlineAfterN}`);
  if (cfg.delegation) out.push("delegation");
  if (cfg.commission) out.push("commission");
  return out;
}
