import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/site-header";
import { RecentAlertsFeed } from "@/components/recent-alerts-feed";
import { fetchValidatorById } from "@/lib/validator-meta";
import { formatTia, truncateAddr } from "@/lib/format";
import { validatorExplorerUrl } from "@/lib/chain";
import { prisma } from "@/lib/db";
import type { ValidatorEventSummary } from "@/lib/api-types";
import type { EventType, Network, Severity } from "@/types/events";

// Render per-request so recent alerts never serve stale-first-hit HTML.
export const dynamic = "force-dynamic";

interface DetailPageProps {
  params: { id: string };
  searchParams?: { network?: string };
}

export default async function ValidatorDetailPage({
  params,
  searchParams,
}: DetailPageProps): Promise<JSX.Element> {
  const network: Network =
    searchParams?.network === "testnet" ? "testnet" : "mainnet";
  const validator = await fetchValidatorById(params.id, network);
  if (!validator) notFound();

  const validatorIdBig = /^\d+$/u.test(validator.id) ? BigInt(validator.id) : null;

  const eventRows =
    validatorIdBig !== null
      ? await prisma.event.findMany({
          where: { validatorId: validatorIdBig, network },
          orderBy: { occurredAt: "desc" },
          take: 10,
        })
      : [];

  const events: ValidatorEventSummary[] = eventRows.map((e) => ({
    id: e.id,
    type: e.type as EventType,
    severity: e.severity as Severity,
    occurredAt: e.occurredAt.toISOString(),
    blockNumber: e.blockNumber !== null ? e.blockNumber.toString() : null,
    payload: (e.payload as Record<string, unknown>) ?? {},
  }));

  const addr =
    validator.authAddress && validator.authAddress !== "0x"
      ? validator.authAddress
      : null;
  const explorer = validatorExplorerUrl(validator.id, network);
  const subscribeHref = `/validator/${encodeURIComponent(validator.id)}/subscribe?network=${network}`;

  return (
    <main className="relative pt-3">
      <div className="glow-field" aria-hidden="true" />

      <SiteHeader network={network} />

      <div className="relative z-10 mx-auto max-w-[1320px] px-4 md:px-6">
        <Link
          href={`/?network=${network}`}
          className="group mt-8 inline-flex animate-fade-down items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-200 ease-out-quint group-hover:-translate-x-0.5" />
          Back to validators
        </Link>

        <section
          className="panel mt-4 animate-fade-up overflow-hidden rounded-2xl"
          style={{ animationDelay: "80ms" }}
        >
          <div className="flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between md:p-7">
            <div className="flex items-center gap-5">
              <ValidatorLogo src={validator.logo} name={validator.name ?? validator.id} />
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-micro text-muted-foreground">
                  Validator #{validator.id} · {network}
                </p>
                <h1 className="mt-1.5 truncate text-3xl font-bold tracking-editorial md:text-4xl">
                  {validator.name ?? `Validator ${validator.id}`}
                </h1>
                {addr ? (
                  <a
                    href={explorer}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-primary"
                  >
                    {truncateAddr(addr)}
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </div>
            <Button asChild size="lg" className="shrink-0 gap-2">
              <Link href={subscribeHref}>
                <Bell className="h-4 w-4" />
                Set up notifications
              </Link>
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-px border-t border-border bg-border/60 md:grid-cols-3">
            <Stat label="Stake" accent>
              {formatTia(validator.stake)}
              <span className="ml-1 text-sm font-sans text-muted-foreground">TIA</span>
            </Stat>
            <Stat label="Status">{validator.status ?? "—"}</Stat>
            <Stat label="Network" className="col-span-2 md:col-span-1">
              {network}
            </Stat>
          </div>
        </section>

        <section className="mb-8 mt-10 animate-fade-up" style={{ animationDelay: "200ms" }}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold tracking-editorial">Recent alerts</h2>
            <p className="text-xs text-muted-foreground">
              Missed blocks · offline · recoveries · staking
            </p>
          </div>
          <div className="mt-4">
            <RecentAlertsFeed events={events} />
          </div>
        </section>
      </div>
    </main>
  );
}

function ValidatorLogo({ src, name }: { src?: string; name: string }): JSX.Element {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  if (!src) {
    return (
      <div
        aria-hidden="true"
        className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-3xl font-bold text-primary ring-1 ring-inset ring-primary/25"
      >
        {initial}
      </div>
    );
  }
  return (
    <span className="relative inline-flex h-20 w-20 shrink-0">
      <span className="absolute -inset-1 rounded-2xl bg-primary/20 blur-lg" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        width={80}
        height={80}
        className="relative h-20 w-20 rounded-2xl object-cover ring-1 ring-inset ring-border"
        referrerPolicy="no-referrer"
      />
    </span>
  );
}

function Stat({
  label,
  children,
  accent,
  className,
}: {
  label: string;
  children: React.ReactNode;
  accent?: boolean;
  className?: string;
}): JSX.Element {
  return (
    <div className={`bg-card p-5 ${className ?? ""}`}>
      <p className="text-[10px] uppercase tracking-micro text-muted-foreground">{label}</p>
      <p
        className={`mt-2 flex items-baseline font-mono text-xl tabular-nums capitalize ${
          accent ? "text-primary" : "text-foreground"
        }`}
      >
        {children}
      </p>
    </div>
  );
}
