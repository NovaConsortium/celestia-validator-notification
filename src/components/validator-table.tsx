"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTia } from "@/lib/format";
import type { ValidatorMetadata } from "@/lib/api-types";
import type { Network } from "@/types/events";

const PAGE_SIZE = 25;

type SortDir = "asc" | "desc";
type SortKey = "stake";

interface ValidatorTableProps {
  validators: ValidatorMetadata[];
  network: Network;
}

export function ValidatorTable({
  validators,
  network,
}: ValidatorTableProps): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = React.useState("");
  const [sortKey, setSortKey] = React.useState<SortKey>("stake");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");
  const [page, setPage] = React.useState(0);

  function toggleSort(next: SortKey): void {
    if (next === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(next);
      setSortDir("desc");
    }
  }

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return validators;
    return validators.filter(
      (v) =>
        v.id.toLowerCase().includes(q) ||
        (v.name ?? "").toLowerCase().includes(q) ||
        (v.authAddress ?? "").toLowerCase().includes(q),
    );
  }, [validators, query]);

  const sorted = React.useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort(
      (a, b) => (Number(a.stake ?? 0) - Number(b.stake ?? 0)) * dir,
    );
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  React.useEffect(() => {
    setPage(0);
  }, [query, sortKey, sortDir, network]);

  function setNetwork(next: Network): void {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("network", next);
    router.push(`/?${params.toString()}`);
  }

  const listKey = `${query}|${sortKey}|${sortDir}|${safePage}|${network}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="group relative min-w-0 flex-1 sm:min-w-[280px]">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors duration-200 group-focus-within:text-primary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search validators by name, id, or address"
            className={cn(
              "h-11 w-full rounded-xl border border-border bg-card/60 pl-10 pr-3 text-sm text-foreground",
              "placeholder:text-muted-foreground/70 outline-none transition-all duration-200",
              "focus:border-primary/55 focus:bg-card focus:shadow-[0_0_0_4px_hsl(var(--primary)/0.1)]",
            )}
          />
        </div>
        <NetworkToggle value={network} onChange={setNetwork} />
      </div>

      <div className="panel overflow-hidden rounded-2xl">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-foreground/[0.015] px-4 py-3 text-[10px] uppercase tracking-micro text-muted-foreground md:grid-cols-[56px_minmax(0,1fr)_180px_120px] md:px-5">
          <span className="hidden md:block">#</span>
          <span>Validator</span>
          <button
            type="button"
            onClick={() => toggleSort("stake")}
            className="flex items-center justify-end gap-1.5 transition-colors hover:text-foreground"
          >
            Stake
            <SortArrow active={sortKey === "stake"} dir={sortDir} />
          </button>
          <span className="hidden text-right md:block">Status</span>
        </div>

        <ul key={listKey} className="divide-y divide-border">
          {pageRows.length === 0 ? (
            <li className="animate-fade-in px-5 py-16 text-center text-sm text-muted-foreground">
              No validators match &ldquo;{query}&rdquo;.
            </li>
          ) : (
            pageRows.map((v, i) => (
              <ValidatorRow key={v.id} v={v} network={network} index={i} />
            ))
          )}
        </ul>
      </div>

      <Pagination
        page={safePage}
        totalPages={totalPages}
        total={sorted.length}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
      />
    </div>
  );
}

function SortArrow({ active, dir }: { active: boolean; dir: SortDir }): JSX.Element {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  return (
    <ChevronUp
      className={cn(
        "h-3.5 w-3.5 text-primary transition-transform duration-300 ease-out-quint",
        dir === "desc" && "rotate-180",
      )}
    />
  );
}

function NetworkToggle({
  value,
  onChange,
}: {
  value: Network;
  onChange: (next: Network) => void;
}): JSX.Element {
  const options = ["mainnet", "testnet"] as const;
  const activeIdx = options.indexOf(value);
  return (
    <div className="relative inline-flex rounded-xl border border-border bg-card/60 p-1 text-[11px] uppercase tracking-micro">
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-lg bg-primary transition-transform duration-300 ease-out-quint"
        style={{ transform: `translateX(${activeIdx * 100}%)` }}
      />
      {options.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={cn(
            "relative z-10 cursor-pointer rounded-lg px-3.5 py-1.5 transition-colors duration-300",
            value === n
              ? "text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function ValidatorRow({
  v,
  network,
  index,
}: {
  v: ValidatorMetadata;
  network: Network;
  index: number;
}): JSX.Element {
  const router = useRouter();
  const href = `/validator/${encodeURIComponent(v.id)}?network=${network}`;
  const delayMs = Math.min(index, 12) * 30;

  function onRowKeyDown(e: React.KeyboardEvent<HTMLLIElement>): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      router.push(href);
    }
  }

  const addr = v.authAddress && v.authAddress !== "0x" ? v.authAddress : null;
  const addrShort = addr
    ? addr.length > 18
      ? `${addr.slice(0, 12)}…${addr.slice(-6)}`
      : addr
    : null;

  return (
    <li
      onClick={() => router.push(href)}
      onKeyDown={onRowKeyDown}
      role="link"
      tabIndex={0}
      aria-label={v.name ? `${v.name} (validator ${v.id})` : `Validator ${v.id}`}
      style={{ animationDelay: `${delayMs}ms` }}
      className={cn(
        "group grid animate-fade-up cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3",
        "px-4 py-3.5 transition-colors duration-200 md:grid-cols-[56px_minmax(0,1fr)_180px_120px] md:px-5",
        "hover:bg-primary/[0.05] focus:outline-none focus-visible:bg-primary/[0.07]",
      )}
    >
      <span className="hidden font-mono text-xs tabular-nums text-muted-foreground group-hover:text-foreground md:block">
        {index + 1}
      </span>

      <div className="flex min-w-0 items-center gap-3">
        <ValidatorLogo src={v.logo} name={v.name ?? v.id} />
        <div className="min-w-0">
          <Link
            href={href}
            onClick={(e) => e.stopPropagation()}
            tabIndex={-1}
            className="block truncate text-sm font-semibold text-foreground transition-colors duration-200 group-hover:text-primary"
          >
            {v.name ?? `Validator ${v.id}`}
          </Link>
          {addrShort ? (
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {addrShort}
            </span>
          ) : null}
        </div>
      </div>

      <div className="text-right">
        {v.stake ? (
          <span className="font-mono text-sm tabular-nums text-foreground">
            {formatTia(v.stake)}
            <span className="ml-1 text-[11px] text-primary">TIA</span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>

      <div className="hidden justify-end md:flex">
        <StatusIndicator status={v.status} />
      </div>
    </li>
  );
}

function ValidatorLogo({ src, name }: { src?: string; name: string }): JSX.Element {
  const [errored, setErrored] = React.useState(false);
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  if (!src || errored) {
    return (
      <div
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-sm font-bold text-primary ring-1 ring-inset ring-primary/20"
      >
        {initial}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={40}
      height={40}
      loading="lazy"
      className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-inset ring-border"
      onError={() => setErrored(true)}
      referrerPolicy="no-referrer"
    />
  );
}

function StatusIndicator({ status }: { status?: string }): JSX.Element {
  const normalized = (status ?? "unknown").toLowerCase();
  const config = (() => {
    if (normalized.includes("jail"))
      return { label: "Jailed", dot: "bg-destructive", text: "text-destructive", ring: "ring-destructive/25" };
    if (normalized === "active")
      return { label: "Active", dot: "bg-success", text: "text-success", ring: "ring-success/25" };
    if (normalized.includes("inactive") || normalized.includes("offline"))
      return { label: status ?? "Inactive", dot: "bg-muted-foreground", text: "text-muted-foreground", ring: "ring-border" };
    return { label: status ?? "Unknown", dot: "bg-muted-foreground", text: "text-muted-foreground", ring: "ring-border" };
  })();

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-micro ring-1 ring-inset",
        config.text,
        config.ring,
      )}
      title={config.label}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      {config.label}
    </span>
  );
}

function Pagination({
  page,
  totalPages,
  total,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}): JSX.Element {
  const start = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span className="font-mono tabular-nums">
        {total === 0 ? "0 results" : `${start}–${end} of ${total}`}
      </span>
      <div className="flex items-center gap-1.5">
        <PageBtn onClick={onPrev} disabled={page === 0} aria-label="Previous">
          <ChevronLeft className="h-4 w-4" />
        </PageBtn>
        <span
          key={page}
          className="inline-block min-w-[64px] animate-fade-in text-center font-mono tabular-nums text-foreground"
        >
          {page + 1} / {totalPages}
        </span>
        <PageBtn onClick={onNext} disabled={page >= totalPages - 1} aria-label="Next">
          <ChevronRight className="h-4 w-4" />
        </PageBtn>
      </div>
    </div>
  );
}

function PageBtn({
  onClick,
  disabled,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...rest}
      className={cn(
        "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-border text-muted-foreground",
        "transition-all duration-200 hover:border-primary/40 hover:text-foreground active:scale-90",
        "disabled:cursor-not-allowed disabled:opacity-35 disabled:active:scale-100",
      )}
    >
      {children}
    </button>
  );
}
