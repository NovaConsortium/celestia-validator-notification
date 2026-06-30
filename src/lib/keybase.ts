/**
 * Resolve validator avatars from their Keybase `identity` (a PGP key id on the
 * Celenium validator record). Celenium has no logo field, but most validators
 * register a Keybase identity whose primary picture is their logo:
 *
 *   GET https://keybase.io/_/api/1.0/user/lookup.json?key_suffix={id}&fields=pictures
 *     → { them: [{ pictures: { primary: { url } } }] }
 *
 * Best-effort and cached for the process lifetime — avatars effectively never
 * change, and a miss just falls back to the initial-letter tile in the UI.
 *
 * ponytail: in-process Map cache, no TTL. Cold start resolves each uncached
 * identity once (concurrency-capped); restart re-warms. If Keybase rate-limits
 * become an issue, move resolution behind a per-row client fetch.
 */
const cache = new Map<string, string | null>(); // identity → url | null (no pic)
const inflight = new Map<string, Promise<string | null>>();

const TIMEOUT_MS = 4000;
const CONCURRENCY = 10;

async function resolveOne(identity: string): Promise<string | null> {
  if (cache.has(identity)) return cache.get(identity) ?? null;
  const pending = inflight.get(identity);
  if (pending) return pending;

  const p = (async (): Promise<string | null> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://keybase.io/_/api/1.0/user/lookup.json?key_suffix=${encodeURIComponent(
          identity,
        )}&fields=pictures`,
        { signal: ctrl.signal, headers: { accept: "application/json" } },
      );
      if (!res.ok) return null;
      const j = (await res.json()) as {
        them?: Array<{ pictures?: { primary?: { url?: string } } }>;
      };
      const url = j.them?.[0]?.pictures?.primary?.url ?? null;
      cache.set(identity, url); // cache hits AND confirmed-no-pic
      return url;
    } catch {
      // Don't cache transient failures — allow a retry on the next pass.
      return null;
    } finally {
      clearTimeout(timer);
      inflight.delete(identity);
    }
  })();

  inflight.set(identity, p);
  return p;
}

/**
 * Resolve avatar URLs for a batch of Keybase identities. Returns a map of
 * identity → url for those that have one (missing/failed identities are
 * omitted). Concurrency-capped so a big validator list doesn't hammer Keybase.
 */
export async function resolveAvatars(
  identities: Array<string | undefined>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const todo = Array.from(
    new Set(identities.filter((x): x is string => Boolean(x))),
  );

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const slice = todo.slice(i, i + CONCURRENCY);
    const urls = await Promise.all(slice.map((id) => resolveOne(id)));
    slice.forEach((id, idx) => {
      const url = urls[idx];
      if (url) out.set(id, url);
    });
  }
  return out;
}
