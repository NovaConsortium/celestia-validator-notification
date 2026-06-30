/**
 * hCaptcha siteverify integration.
 *
 * If `HCAPTCHA_SECRET` is not set, verification is skipped and we log a
 * warning + return true. This makes local dev easy without a hCaptcha
 * account, but deployments MUST set the secret.
 */

const SITEVERIFY_URL = "https://hcaptcha.com/siteverify";
const TIMEOUT_MS = 8_000;

interface SiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
}

export async function verifyHcaptcha(
  token: string | null | undefined,
  ip?: string,
): Promise<boolean> {
  const secret = process.env.HCAPTCHA_SECRET;
  if (!secret) {
    // eslint-disable-next-line no-console
    console.warn("[hcaptcha] HCAPTCHA_SECRET not set - skipping verification");
    return true;
  }
  if (!token) return false;

  // Whitelisted dev sentinel: when the frontend captcha widget is not
  // mounted (no NEXT_PUBLIC_HCAPTCHA_SITEKEY) the form sends this literal
  // token. Accept it ONLY when not running in production so local dev
  // stays easy without leaking a bypass to deployed envs.
  if (token === "dev-captcha-disabled" && process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn("[hcaptcha] dev sentinel accepted - non-production only");
    return true;
  }

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: ac.signal,
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[hcaptcha] siteverify HTTP ${res.status}`);
      return false;
    }
    const data = (await res.json()) as SiteverifyResponse;
    return Boolean(data.success);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[hcaptcha] siteverify error:", (err as Error).message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
