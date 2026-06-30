import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ManageView } from "@/components/manage-view";
import { SiteHeader } from "@/components/site-header";
import { prisma } from "@/lib/db";
import { serializeSubscription } from "@/lib/api-helpers";
import { fetchValidatorMetadata } from "@/lib/validator-meta";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";
import type { ChannelConfig, ChannelType } from "@/types/channels";
import type { Network } from "@/types/events";
import type { ChannelOutput, SubscriptionResponse } from "@/lib/api-types";

export interface RevealableChannelSecrets {
  webhookUrl?: string;
  routingKey?: string;
}

export const dynamic = "force-dynamic";

interface ManagePageProps {
  params: { id: string };
  searchParams?: { created?: string };
}

async function loadOwnedSubscription(id: string): Promise<
  | {
      kind: "ok";
      sub: SubscriptionResponse;
      revealable: Record<string, RevealableChannelSecrets>;
    }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) return { kind: "unauthenticated" };

  const sub = await prisma.subscription.findUnique({
    where: { id },
    include: { channels: true },
  });
  if (!sub) return { kind: "not_found" };
  if (sub.walletAddress.toLowerCase() !== session.addr.toLowerCase()) {
    return { kind: "forbidden" };
  }
  // Owner-only: expose plaintext webhookUrl / routingKey so the UI can
  // offer a "view" toggle. authToken stays encrypted at rest and is
  // never returned. This map is only sent to the verified owner.
  const revealable: Record<string, RevealableChannelSecrets> = {};
  for (const c of sub.channels) {
    const cfg = (c.config as ChannelConfig) ?? {};
    const r: RevealableChannelSecrets = {};
    if (typeof cfg.webhookUrl === "string" && cfg.webhookUrl) {
      r.webhookUrl = cfg.webhookUrl;
    }
    if (typeof cfg.routingKey === "string" && cfg.routingKey) {
      r.routingKey = cfg.routingKey;
    }
    if (r.webhookUrl || r.routingKey) revealable[c.id] = r;
  }
  return { kind: "ok", sub: serializeSubscription(sub), revealable };
}

export default async function ManagePage({
  params,
  searchParams,
}: ManagePageProps): Promise<JSX.Element> {
  // Kick off both metadata fetches in parallel with the DB query. The
  // validator directory endpoint is 60s-cached by Next, so the unused side is
  // essentially free once warm. We pick the right one once we know the
  // sub's network.
  const mainnetMetaPromise = fetchValidatorMetadata("mainnet");
  const testnetMetaPromise = fetchValidatorMetadata("testnet");

  const result = await loadOwnedSubscription(params.id);
  if (result.kind === "unauthenticated") {
    redirect(`/my-alerts?from=${encodeURIComponent(`/manage/${params.id}`)}`);
  }
  if (result.kind === "forbidden") {
    redirect("/my-alerts?error=not_owner");
  }
  if (result.kind === "not_found") notFound();

  const subscription = result.sub;
  const meta =
    subscription.network === "mainnet"
      ? await mainnetMetaPromise
      : await testnetMetaPromise;
  const validator = meta.find((v) => v.id === subscription.validatorId) ?? null;

  if (searchParams?.created === "1") {
    return (
      <SuccessSummary
        subscription={subscription}
        validatorName={validator?.name ?? null}
        validatorLogo={validator?.logo ?? null}
      />
    );
  }

  return (
    <main className="relative z-10 pt-6 md:pt-8">
      <SiteHeader network={subscription.network as Network} />
      <div className="mx-auto max-w-4xl px-4 pb-20">
        <Link
          href="/my-alerts"
          className="mb-6 mt-6 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to my alerts
        </Link>

        <ManageView
          initial={subscription}
          validatorName={validator?.name ?? null}
          validatorLogo={validator?.logo ?? null}
          revealable={result.revealable}
        />
      </div>
    </main>
  );
}

const CHANNEL_META: Record<
  ChannelType,
  { label: string; iconSrc?: string; color: string }
> = {
  discord: { label: "Discord", iconSrc: "/discord-icon.png", color: "#5865F2" },
  slack: { label: "Slack", iconSrc: "/slack-icon.png", color: "#E01E5A" },
  telegram: {
    label: "Telegram",
    iconSrc: "/telegram-icon.png",
    color: "#229ED9",
  },
  pagerduty: {
    label: "PagerDuty",
    iconSrc: "/pagerduty-icon.webp",
    color: "#06AC38",
  },
  email: { label: "Email", color: "#F59E0B" },
};

function SuccessSummary({
  subscription,
  validatorName,
  validatorLogo,
}: {
  subscription: SubscriptionResponse;
  validatorName: string | null;
  validatorLogo: string | null;
}): JSX.Element {
  const network = subscription.network as Network;
  const enabledChannels = subscription.channels.filter((c) => c.enabled);
  return (
    <main className="relative z-10 pt-6 md:pt-8">
      <SiteHeader network={network} />

      <div className="mx-auto max-w-2xl px-4 pb-20">
      <div className="mt-10 flex flex-col items-center text-center">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          You&apos;re subscribed
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage or edit any time from{" "}
          <Link href="/my-alerts" className="underline hover:text-foreground">
            /my-alerts
          </Link>
          .
        </p>
      </div>

      <Card className="mt-8">
        <CardContent className="flex items-center gap-4 pt-6">
          {validatorLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={validatorLogo}
              alt=""
              width={56}
              height={56}
              className="h-14 w-14 shrink-0 border border-foreground/10 bg-foreground/[0.04] object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-14 w-14 shrink-0 items-center justify-center border border-foreground/10 bg-foreground/[0.04] text-xl font-bold text-foreground/70"
            >
              {(validatorName ?? `V${subscription.validatorId}`)
                .trim()
                .charAt(0)
                .toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Active validator · {network}
            </p>
            <p className="mt-1 truncate text-lg font-semibold">
              {validatorName ?? `Validator ${subscription.validatorId}`}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              #{subscription.validatorId}
            </p>
          </div>
        </CardContent>
      </Card>

      <section className="mt-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Channels ({enabledChannels.length})
        </h2>
        {enabledChannels.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            No active channels.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {enabledChannels.map((c) => (
              <ChannelChip key={c.id} channel={c} />
            ))}
          </ul>
        )}
      </section>

      <div className="mt-10 flex justify-center">
        <Button asChild size="lg">
          <Link href="/my-alerts">Go to my alerts</Link>
        </Button>
      </div>
      </div>
    </main>
  );
}

function ChannelChip({ channel }: { channel: ChannelOutput }): JSX.Element {
  const meta = CHANNEL_META[channel.type];
  return (
    <li
      className="flex items-center gap-3 rounded-md border bg-card p-3"
      style={{ borderColor: `${meta.color}40` }}
    >
      <span
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: `${meta.color}1A`, color: meta.color }}
      >
        {meta.iconSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={meta.iconSrc}
            alt=""
            width={20}
            height={20}
            className="h-5 w-5 object-contain"
          />
        ) : (
          <Mail className="h-4 w-4" />
        )}
      </span>
      <span className="truncate text-sm font-medium">{meta.label}</span>
    </li>
  );
}
