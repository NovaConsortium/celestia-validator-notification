"use client";

import * as React from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Self-contained email OTP verification flow used inside the email
 * channel card. Drives `/api/email/verify/start` + `/api/email/verify/confirm`,
 * surfaces inline error / cooldown UI, and reports the final
 * `verifiedToken` to the parent via `onVerified(email, token)`.
 *
 * Mirrors PhoneVerify state machine:
 *   idle           - email editable, code hidden
 *   sending        - POST start in flight
 *   awaiting-code  - code field shown, "Verify" enabled, 60s resend cooldown
 *   verifying      - POST confirm in flight
 *   verified       - read-only badge; email edits clear back to idle
 */
type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "awaiting-code"; cooldownEndsAt: number }
  | { kind: "verifying" }
  | { kind: "verified" };

interface EmailVerifyProps {
  initialEmail?: string;
  initiallyVerified?: boolean;
  onVerified: (email: string, verifiedToken: string) => void;
  onEmailInvalidated?: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const COOLDOWN_MS = 60 * 1000;

export function EmailVerify({
  initialEmail = "",
  initiallyVerified = false,
  onVerified,
  onEmailInvalidated,
}: EmailVerifyProps): JSX.Element {
  const [email, setEmail] = React.useState(initialEmail);
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [state, setState] = React.useState<State>(
    initiallyVerified ? { kind: "verified" } : { kind: "idle" },
  );
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => {
    if (state.kind !== "awaiting-code") return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [state.kind]);

  function onEmailChange(next: string): void {
    setEmail(next);
    setError(null);
    if (state.kind === "verified") {
      onEmailInvalidated?.();
      setState({ kind: "idle" });
      setCode("");
    } else if (state.kind === "awaiting-code") {
      setState({ kind: "idle" });
      setCode("");
    }
  }

  async function sendCode(): Promise<void> {
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) {
      setError("Enter a valid email address");
      return;
    }
    setError(null);
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/email/verify/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: normalized }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(
          body.message ?? body.error ?? `Failed to send code (HTTP ${res.status})`,
        );
      }
      setState({ kind: "awaiting-code", cooldownEndsAt: Date.now() + COOLDOWN_MS });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send code");
      setState({ kind: "idle" });
    }
  }

  async function verifyCode(): Promise<void> {
    if (!/^\d{4,10}$/u.test(code)) {
      setError("Enter the digits sent to your email");
      return;
    }
    const normalized = email.trim().toLowerCase();
    setError(null);
    setState({ kind: "verifying" });
    try {
      const res = await fetch("/api/email/verify/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: normalized, code }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        verifiedToken?: string;
      };
      if (!res.ok || !body.verifiedToken) {
        throw new Error(
          body.message ?? body.error ?? `Verification failed (HTTP ${res.status})`,
        );
      }
      setState({ kind: "verified" });
      onVerified(normalized, body.verifiedToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
      setState((prev) =>
        prev.kind === "verifying"
          ? { kind: "awaiting-code", cooldownEndsAt: Date.now() + COOLDOWN_MS }
          : prev,
      );
    }
  }

  const cooldownLeft =
    state.kind === "awaiting-code"
      ? Math.max(0, Math.ceil((state.cooldownEndsAt - now) / 1000))
      : 0;
  const emailEditable = state.kind === "idle" || state.kind === "verified";

  return (
    <div className="space-y-2">
      <label className="space-y-1 text-sm">
        <span className="font-medium">Recipient email</span>
        <div className="flex gap-2">
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder="you@example.com"
            disabled={!emailEditable}
          />
          {state.kind === "verified" ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Verified
            </span>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={sendCode}
              disabled={state.kind === "sending" || state.kind === "verifying" || cooldownLeft > 0}
            >
              {state.kind === "sending" ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : null}
              {state.kind === "awaiting-code" ? "Resend" : "Send code"}
            </Button>
          )}
        </div>
      </label>

      {state.kind === "awaiting-code" || state.kind === "verifying" ? (
        <div className="flex items-center gap-2">
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/gu, ""))}
            placeholder="6-digit code"
            className="max-w-[10rem]"
            disabled={state.kind === "verifying"}
          />
          <Button
            type="button"
            size="sm"
            onClick={verifyCode}
            disabled={state.kind === "verifying" || code.length < 4}
          >
            {state.kind === "verifying" ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : null}
            Verify
          </Button>
          {cooldownLeft > 0 ? (
            <span className="text-xs text-muted-foreground">
              Resend in {cooldownLeft}s
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
