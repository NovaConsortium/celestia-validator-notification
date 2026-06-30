/**
 * Celenium websocket consumer — the per-block trigger.
 *
 * Subscribes to the `blocks` channel (one message per new block: height +
 * proposer, NO signature set) and invokes `onBlock(height)` for each new head.
 * The worker then resolves the signer set for that height via CometBFT
 * `/commit` (see commit.ts). Auto-reconnects with exponential backoff
 * (1s → 30s) and alerts after a sustained outage, mirroring the old SSE
 * harness. Node 18+/global `WebSocket` is used (Node 24 here) — no `ws` dep.
 */
import { reportStatus, describeError } from "@/lib/monitoring";
import { chainFor } from "@/lib/chain";
import type { Network } from "@/types/events";

export interface BlockEvent {
  height: number;
  network: Network;
}

interface WsHandle {
  stop(): void;
}

interface CeleniumBlocksMessage {
  channel?: string;
  body?: { height?: number | string };
}

function parseHeight(raw: unknown): number | null {
  if (raw == null || typeof raw !== "object") return null;
  const msg = raw as CeleniumBlocksMessage;
  if (msg.channel !== "blocks") return null;
  const h = msg.body?.height;
  const n = typeof h === "number" ? h : typeof h === "string" ? Number(h) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function startBlockConsumer(
  network: Network,
  onBlock: (block: BlockEvent) => void,
): WsHandle {
  const url = chainFor(network).celeniumWs;
  let stopped = false;
  let backoffMs = 1_000;
  let ws: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let consecutiveFailures = 0;
  let alertedDown = false;

  const open = () => {
    if (stopped) return;
    // eslint-disable-next-line no-console
    console.log(`[ws:${network}] connecting ${url}`);
    try {
      ws = new WebSocket(url);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[ws:${network}] construct failed`, err);
      scheduleReconnect();
      return;
    }

    ws.addEventListener("open", () => {
      // eslint-disable-next-line no-console
      console.log(`[ws:${network}] connected`);
      backoffMs = 1_000;
      consecutiveFailures = 0;
      ws?.send(JSON.stringify({ method: "subscribe", body: { channel: "blocks" } }));
      ws?.send(JSON.stringify({ method: "subscribe", body: { channel: "head" } }));
      if (alertedDown) {
        reportStatus({
          key: `ws:${network}`,
          state: "up",
          severity: "info",
          title: `Celenium WS reconnected (${network})`,
          message: `Block stream for ${network} is back online.`,
        });
        alertedDown = false;
      }
    });

    ws.addEventListener("message", (ev: MessageEvent) => {
      let parsed: unknown;
      try {
        parsed = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
      } catch {
        return;
      }
      const height = parseHeight(parsed);
      if (height === null) return; // head / subscribe-ack / other channels
      try {
        onBlock({ height, network });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[ws:${network}] onBlock threw`, err);
      }
    });

    ws.addEventListener("error", (err) => {
      // eslint-disable-next-line no-console
      console.warn(`[ws:${network}] error`, (err as ErrorEvent)?.message ?? "");
    });

    ws.addEventListener("close", () => {
      if (stopped) return;
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3 && !alertedDown) {
        alertedDown = true;
        reportStatus({
          key: `ws:${network}`,
          state: "down",
          severity: "warning",
          title: `Celenium WS disconnected (${network})`,
          message: `Block stream for ${network} failed ${consecutiveFailures} reconnect attempts. Missed-block detection is offline.`,
          fields: [{ name: "url", value: url }],
        });
      }
      scheduleReconnect();
    });
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    ws = null;
    reconnectTimer = setTimeout(open, backoffMs);
    backoffMs = Math.min(backoffMs * 2, 30_000);
  };

  open();

  return {
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      try {
        ws?.close();
      } catch {
        /* noop */
      }
      ws = null;
    },
  };
}
