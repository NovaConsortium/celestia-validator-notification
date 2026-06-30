import { Suspense } from "react";
import { fetchValidatorMetadata } from "@/lib/validator-meta";
import { ValidatorTable } from "@/components/validator-table";
import { SiteHeader } from "@/components/site-header";
import { AnimatedNumber } from "@/components/ui/animated-number";
import type { Network } from "@/types/events";

export const revalidate = 60;

interface HomePageProps {
  searchParams?: { network?: string };
}

export default async function HomePage({
  searchParams,
}: HomePageProps): Promise<JSX.Element> {
  const network: Network =
    searchParams?.network === "testnet" ? "testnet" : "mainnet";

  // Degraded-mode fallback: render with an empty list + banner rather than a
  // 500 when Celenium is down. ISR keeps serving the last good snapshot.
  let validators: Awaited<ReturnType<typeof fetchValidatorMetadata>> = [];
  let directoryDown = false;
  try {
    validators = await fetchValidatorMetadata(network);
  } catch (err) {
    directoryDown = true;
    // eslint-disable-next-line no-console
    console.error(
      `[home] validator fetch failed for ${network}: ${(err as Error).message}`,
    );
  }

  // Celenium `stake` is base utia (1 TIA = 1e6 utia).
  const totalStake =
    validators.reduce((sum, v) => sum + (Number(v.stake) || 0), 0) / 1_000_000;
  const activeCount = validators.filter(
    (v) => (v.status ?? "").toLowerCase() === "active",
  ).length;

  return (
    <main className="relative pt-3">
      <div className="glow-field" aria-hidden="true" />

      <SiteHeader network={network} />

      <div className="relative z-10 mx-auto max-w-[1320px] px-4 md:px-6">
        <section className="mt-12 grid items-end gap-8 md:mt-16 md:grid-cols-[1.25fr_minmax(0,1fr)]">
          <div>
            <span className="inline-flex animate-fade-down items-center gap-2 rounded-full border border-primary/25 bg-primary/5 px-3 py-1 text-[11px] uppercase tracking-micro text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Missed-block · offline · staking
            </span>
            <h1
              className="display mt-5 animate-fade-up-lg text-[clamp(2.6rem,6vw,5rem)] text-foreground"
              style={{ animationDelay: "60ms" }}
            >
              Never miss a beat from your{" "}
              <span className="text-primary">Celestia validator.</span>
            </h1>
            <p
              className="mt-5 max-w-lg animate-fade-up text-[15px] leading-relaxed text-muted-foreground"
              style={{ animationDelay: "200ms" }}
            >
              Pick your validator and route alerts to Discord, Telegram, Slack,
              PagerDuty, or email. Every missed block is confirmed against the
              canonical CometBFT commit — so you only get paged when it&rsquo;s
              real.
            </p>
          </div>

          <dl
            className="panel grid animate-fade-up grid-cols-2 gap-px overflow-hidden rounded-2xl bg-border/60"
            style={{ animationDelay: "320ms" }}
          >
            <Stat
              className="col-span-2"
              label="Total stake watched"
              big
              suffix="TIA"
            >
              <AnimatedNumber value={totalStake} format="comma" fallback="—" />
            </Stat>
            <Stat label="Validators">
              <AnimatedNumber value={validators.length} fallback="—" />
            </Stat>
            <Stat label="Active set" accent>
              <AnimatedNumber value={activeCount} fallback="—" />
            </Stat>
          </dl>
        </section>

        {directoryDown ? (
          <div
            role="status"
            className="mt-8 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-foreground/80"
          >
            Validator directory is temporarily unavailable — showing an empty
            list. Refresh in a minute.
          </div>
        ) : null}

        <section
          className="relative mt-12 animate-fade-up pb-4"
          style={{ animationDelay: "440ms" }}
        >
          <Suspense fallback={<TableSkeleton />}>
            <ValidatorTable validators={validators} network={network} />
          </Suspense>
        </section>
      </div>
    </main>
  );
}

function Stat({
  label,
  children,
  suffix,
  big,
  accent,
  className,
}: {
  label: string;
  children: React.ReactNode;
  suffix?: string;
  big?: boolean;
  accent?: boolean;
  className?: string;
}): JSX.Element {
  return (
    <div className={`bg-card p-5 ${className ?? ""}`}>
      <dt className="text-[10px] uppercase tracking-micro text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`mt-2 flex items-baseline gap-1.5 font-mono tabular-nums ${
          big ? "text-4xl md:text-[2.75rem]" : "text-2xl"
        } ${accent ? "text-primary" : "text-foreground"}`}
      >
        {children}
        {suffix ? (
          <span className="text-sm font-sans text-muted-foreground">{suffix}</span>
        ) : null}
      </dd>
    </div>
  );
}

function TableSkeleton(): JSX.Element {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="skeleton h-11 min-w-[260px] flex-1 rounded-xl" />
        <div className="skeleton h-9 w-40 rounded-xl" />
      </div>
      <div className="panel overflow-hidden rounded-2xl">
        <ul className="divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <li
              key={i}
              className="grid animate-fade-up grid-cols-[44px_minmax(0,1fr)_120px] items-center gap-4 px-5 py-4 md:grid-cols-[56px_minmax(0,1fr)_180px_120px]"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="skeleton h-10 w-10 rounded-xl" />
              <div className="space-y-2">
                <div className="skeleton h-3 w-40 rounded" />
                <div className="skeleton h-2.5 w-24 rounded" />
              </div>
              <div className="skeleton ml-auto h-3 w-24 rounded" />
              <div className="skeleton ml-auto hidden h-3 w-16 rounded md:block" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
