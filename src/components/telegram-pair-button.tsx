"use client";

import * as React from "react";
import { Check, ExternalLink, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiClient, ApiClientError } from "@/lib/api-client";

interface TelegramPairButtonProps {
  /** Channel-bound: the user is editing an already-saved Telegram channel. */
  channelId?: string;
  /**
   * Subscription-bound: the channel hasn't been saved but the subscription
   * exists (e.g. /manage page, user added a new Telegram row). Server
   * creates the channel on demand.
   */
  subscriptionId?: string;
  /**
   * If a wallet-scoped pairing was started in a prior render and is still
   * waiting for confirmation, restore that token so we can keep polling.
   */
  existingToken?: string;
  /** Fully paired (chatId set on server). */
  paired?: boolean;
  /** Display label of the paired chat ("@username"), shown next to the badge. */
  pairedTitle?: string;
  /** Channel-bound: the server-confirmed channel id (before /start TOKEN). */
  onChannelId?: (channelId: string) => void;
  /** Channel-bound: pairing fully complete. */
  onPaired: (channelId: string) => void;
  /** Wallet-scoped: pairing token to carry through to subscription create. */
  onToken?: (token: string) => void;
}

type Mode =
  | { kind: "channel"; channelId: string }
  | { kind: "token"; token: string };

type State =
  | { kind: "idle" }
  | { kind: "pairing"; deepLink: string; expiresAt: number; mode: Mode }
  | { kind: "paired"; chatTitle?: string; mode?: Mode }
  | { kind: "error"; message: string };

const POLL_MS = 3000;
const TIMEOUT_MS = 5 * 60_000;

export function TelegramPairButton({
  channelId,
  subscriptionId,
  existingToken,
  paired,
  pairedTitle,
  onChannelId,
  onPaired,
  onToken,
}: TelegramPairButtonProps): JSX.Element {
  const [state, setState] = React.useState<State>(() =>
    paired
      ? {
          kind: "paired",
          chatTitle: pairedTitle,
          mode: channelId ? { kind: "channel", channelId } : undefined,
        }
      : { kind: "idle" },
  );
  const cancelRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    return () => cancelRef.current?.abort();
  }, []);

  // Resume polling when the parent restores a wallet-scoped token (e.g. the
  // user navigated away and came back mid-pair).
  React.useEffect(() => {
    if (paired) return;
    if (state.kind !== "idle") return;
    if (!existingToken) return;
    setState({
      kind: "pairing",
      deepLink: "",
      expiresAt: Date.now() + TIMEOUT_MS,
      mode: { kind: "token", token: existingToken },
    });
    void pollByToken(existingToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingToken, paired]);

  async function startPair(): Promise<void> {
    setState({ kind: "idle" });
    try {
      let body:
        | { channelId: string }
        | { subscriptionId: string }
        | Record<string, never>;
      if (channelId) body = { channelId };
      else if (subscriptionId) body = { subscriptionId };
      else body = {};

      const res = await apiClient.pairTelegram(body);
      const expiresAt = new Date(res.expiresAt).getTime();
      if (res.channelId) {
        if (!channelId) onChannelId?.(res.channelId);
        setState({
          kind: "pairing",
          deepLink: res.deepLink,
          expiresAt,
          mode: { kind: "channel", channelId: res.channelId },
        });
        void pollUntilPaired(res.channelId);
      } else {
        onToken?.(res.token);
        setState({
          kind: "pairing",
          deepLink: res.deepLink,
          expiresAt,
          mode: { kind: "token", token: res.token },
        });
        void pollByToken(res.token);
      }
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to start pairing",
      });
    }
  }

  async function pollUntilPaired(id: string): Promise<void> {
    cancelRef.current?.abort();
    const ctrl = new AbortController();
    cancelRef.current = ctrl;
    const start = Date.now();
    while (!ctrl.signal.aborted && Date.now() - start < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (ctrl.signal.aborted) return;
      try {
        const status = await apiClient.getChannelStatus(id, ctrl.signal);
        if (status.paired) {
          setState({
            kind: "paired",
            chatTitle: status.chatTitle,
            mode: { kind: "channel", channelId: id },
          });
          onPaired(id);
          return;
        }
        if (status.lastErrorMsg) {
          setState({ kind: "error", message: status.lastErrorMsg });
          return;
        }
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 404) continue;
        if (ctrl.signal.aborted) return;
      }
    }
    if (!ctrl.signal.aborted) {
      setState({
        kind: "error",
        message: "Pairing timed out. Click to try again.",
      });
    }
  }

  async function pollByToken(token: string): Promise<void> {
    cancelRef.current?.abort();
    const ctrl = new AbortController();
    cancelRef.current = ctrl;
    const start = Date.now();
    while (!ctrl.signal.aborted && Date.now() - start < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (ctrl.signal.aborted) return;
      try {
        const status = await apiClient.getTelegramPairingStatus(
          token,
          ctrl.signal,
        );
        if (status.paired) {
          setState({
            kind: "paired",
            chatTitle: status.chatTitle,
            mode: { kind: "token", token },
          });
          return;
        }
        if (status.error) {
          setState({ kind: "error", message: status.error });
          return;
        }
        if (status.expired) {
          setState({
            kind: "error",
            message: "Pairing token expired. Click to start a new one.",
          });
          return;
        }
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 404) {
          setState({
            kind: "error",
            message: "Pairing token expired. Click to start a new one.",
          });
          return;
        }
        if (ctrl.signal.aborted) return;
      }
    }
    if (!ctrl.signal.aborted) {
      setState({
        kind: "error",
        message: "Pairing timed out. Click to try again.",
      });
    }
  }

  if (state.kind === "paired") {
    const title = state.chatTitle ?? pairedTitle;
    return (
      <div className="inline-flex max-w-full items-center gap-2 rounded-md border border-emerald-600/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
        <Check className="h-4 w-4 shrink-0" />
        <span className="truncate">
          Paired{title ? <> with <span className="font-medium">{title}</span></> : null}
        </span>
      </div>
    );
  }

  if (state.kind === "pairing") {
    return (
      <div className="rounded-md border bg-muted/40 p-4 text-sm">
        <ol className="space-y-3">
          <li className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                1
              </span>
              Open the bot in Telegram
            </span>
            {state.deepLink ? (
              <Button asChild type="button" size="sm">
                <a href={state.deepLink} target="_blank" rel="noreferrer">
                  Open Telegram <ExternalLink className="ml-2 h-3 w-3" />
                </a>
              </Button>
            ) : null}
          </li>
          <li className="text-muted-foreground">
            <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">
              2
            </span>
            Tap <span className="font-mono text-foreground">Start</span> in the bot. Telegram fills in the token automatically.
          </li>
          <li className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Waiting for confirmation…
          </li>
        </ol>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="space-y-2">
        <Button type="button" variant="outline" onClick={startPair}>
          Pair with Telegram
        </Button>
        <p className="inline-flex items-center gap-2 text-xs text-destructive">
          <X className="h-3 w-3" />
          {state.message}
        </p>
      </div>
    );
  }

  return (
    <Button type="button" variant="outline" onClick={startPair}>
      Pair with Telegram
    </Button>
  );
}
