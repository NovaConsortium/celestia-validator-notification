/**
 * Display helpers shared across pages. Pure functions, no React.
 */

/** Celestia base unit: 1 TIA = 1e6 utia. */
const UTIA_PER_TIA = 1_000_000;

/**
 * Format a utia-denominated stake (Celenium `stake`, base units) as TIA.
 *
 * Celenium returns stake in base utia (e.g. "56414362599369" = 56,414,362.6
 * TIA). Divides by 1e6 and renders up to 2 fraction digits with thousands
 * separators. Returns "-" for missing values.
 */
export function formatTia(stakeUtia: string | number | undefined): string {
  if (stakeUtia === undefined || stakeUtia === null || stakeUtia === "")
    return "-";
  const n = typeof stakeUtia === "number" ? stakeUtia : Number(stakeUtia);
  if (!Number.isFinite(n)) return String(stakeUtia);
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(n / UTIA_PER_TIA);
}

/** Format a 0-100 success rate as "97.42%". */
export function formatPercent(pct: number | undefined): string {
  if (pct === undefined || pct === null || !Number.isFinite(pct)) return "-";
  return `${pct.toFixed(2)}%`;
}

/** Truncate `0xABCD…1234` for chain addresses. */
export function truncateAddr(addr: string | undefined): string {
  if (!addr) return "-";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Relative-time string for an ISO date. Falls back to absolute on parse fail. */
export function relativeTime(iso: string | Date | undefined): string {
  if (!iso) return "-";
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  const abs = Math.abs(sec);
  const sign = sec >= 0 ? "ago" : "from now";
  if (abs < 60) return `${abs}s ${sign}`;
  if (abs < 3600) return `${Math.round(abs / 60)}m ${sign}`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h ${sign}`;
  if (abs < 86400 * 30) return `${Math.round(abs / 86400)}d ${sign}`;
  return date.toISOString().slice(0, 10);
}

/**
 * Coerce a wei-ish value (bigint, decimal string, or finite number) into a
 * BigInt. Returns null on garbage input.
 */
export function toBigIntLoose(value: unknown): bigint | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    try {
      return BigInt(trimmed);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Format a utia base-unit amount → TIA with thousands separators and up to
 * 4 trailing decimals (trailing zeros stripped). Returns "" for unparseable
 * input. (Delegation amounts aren't emitted on Celestia today; kept for the
 * shared event-feed renderer.)
 */
export function formatAmountTia(value: unknown): string {
  const n = toBigIntLoose(value);
  if (n === null) return "";
  const base = 1_000_000n; // utia per TIA
  const whole = n / base;
  const frac = n % base;
  const intWithCommas = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decTrimmed = frac.toString().padStart(6, "0").slice(0, 4).replace(/0+$/, "");
  return decTrimmed ? `${intWithCommas}.${decTrimmed}` : intWithCommas;
}

/**
 * Render a Celenium commission rate (decimal fraction string, e.g. "0.1")
 * as a percent with two decimals + "%" suffix.
 */
export function formatCommissionPct(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  return `${(n * 100).toFixed(2)}%`;
}

/** ISO date as "2026-04-25 16:30 UTC". */
export function formatUtc(iso: string | Date | undefined): string {
  if (!iso) return "-";
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
}
