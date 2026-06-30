/**
 * In-memory token-bucket rate limiter, keyed by IP + endpoint.
 *
 * Suitable for single-replica self-host deployments (the project's stated
 * topology). For horizontal scale, replace with Redis-backed buckets.
 *
 * IP extraction prefers the first value in `x-forwarded-for`, falling
 * back to `x-real-ip`, then the literal string `"unknown"`. This assumes
 * the deployment puts a trusted proxy in front (Caddy/nginx/Traefik) -
 * never trust XFF directly off the public internet.
 */

export interface RateLimitOptions {
  /** Tokens per minute. Default 10. */
  rpm?: number;
  /** Burst capacity. Defaults to `rpm`. */
  burst?: number;
  /** Inject a clock for tests. Default `Date.now`. */
  now?: () => number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until next token is available. Only set when `ok=false`. */
  retryAfter?: number;
  remaining: number;
}

interface Bucket {
  tokens: number;
  last: number; // ms timestamp of last refill
  capacity: number;
  refillPerMs: number; // tokens added per millisecond
}

// Module-level state. Process-local; resets on restart. For tests, use
// `__resetRateLimit()`.
const buckets = new Map<string, Bucket>();

export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // Take the leftmost (original client). Trim whitespace.
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export async function rateLimit(
  req: Request,
  key: string,
  opts: RateLimitOptions = {},
): Promise<RateLimitResult> {
  const ip = getClientIp(req);
  return rateLimitByKey(`${key}:${ip}`, opts);
}

/**
 * Lower-level helper for callers that already have a composite key
 * (e.g. tests, or per-userId limits).
 */
export function rateLimitByKey(
  fullKey: string,
  opts: RateLimitOptions = {},
): RateLimitResult {
  const rpm = opts.rpm ?? 10;
  const capacity = opts.burst ?? rpm;
  const now = opts.now ? opts.now() : Date.now();
  const refillPerMs = rpm / 60_000;

  let b = buckets.get(fullKey);
  if (!b) {
    b = { tokens: capacity, last: now, capacity, refillPerMs };
    buckets.set(fullKey, b);
  } else {
    // Refill since last touch.
    const elapsed = Math.max(0, now - b.last);
    b.tokens = Math.min(b.capacity, b.tokens + elapsed * b.refillPerMs);
    b.last = now;
    // Allow opts changes between calls (don't shrink bucket below current tokens).
    b.capacity = capacity;
    b.refillPerMs = refillPerMs;
  }

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { ok: true, remaining: Math.floor(b.tokens) };
  }
  const deficit = 1 - b.tokens;
  const msUntilNext = b.refillPerMs > 0 ? Math.ceil(deficit / b.refillPerMs) : 60_000;
  return {
    ok: false,
    retryAfter: Math.max(1, Math.ceil(msUntilNext / 1000)),
    remaining: 0,
  };
}

/** Test helper. Not exported in production paths. */
export function __resetRateLimit(): void {
  buckets.clear();
}
