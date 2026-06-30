import type {
  AuthNonceResponse,
  AuthSessionResponse,
  AuthVerifyRequest,
  AuthVerifyResponse,
  ChannelStatusResponse,
  ChannelTestRequest,
  ChannelTestResponse,
  CreateSubscriptionRequest,
  CreateSubscriptionResponse,
  DeleteSubscriptionResponse,
  MineSubscriptionsResponse,
  SubscriptionResponse,
  TelegramPairRequest,
  TelegramPairResponse,
  TelegramPairingStatusResponse,
  UpdateSubscriptionRequest,
  ValidatorEventsResponse,
} from "@/lib/api-types";
import type { EventType } from "@/types/events";

interface TelegramTestExtras {
  eventType?: EventType;
  templates?: Partial<Record<EventType, string>>;
  rawTemplate?: boolean;
}

/**
 * Thin typed wrapper around fetch for our /api/* routes. Throws an
 * `ApiClientError` on non-2xx so callers can `.catch` and surface
 * inline form errors.
 */
export class ApiClientError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.body = body;
  }
}

const ERROR_CODE_LABELS: Record<string, string> = {
  phone_not_verified: "Verify your phone first: enter number, click Send code, type the SMS OTP, then click Verify.",
  missing_phone: "Enter a phone number in E.164 format (e.g. +15551234567).",
  invalid_phone: "Enter a phone number in E.164 format (e.g. +15551234567).",
  missing_token: "Verify the phone before saving.",
  expired_token: "Verification expired. Send a new code.",
  invalid_token: "Verification token invalid. Send a new code.",
  verify_error: "The verification provider could not send the code.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  invalid_body: "Some fields are invalid. Check the form and try again.",
  invalid_json: "Bad request body.",
  db_error: "Database error. Try again.",
};

function humanizeErrorCode(code: string): string {
  return ERROR_CODE_LABELS[code] ?? code.replace(/_/gu, " ");
}

interface RequestOpts {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Pass `cache: "no-store"` for status polling endpoints. */
  cache?: RequestCache;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = "GET", body, signal, cache } = opts;
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
    cache,
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    const msg = obj && typeof obj.message === "string" && obj.message.length > 0
      ? obj.message
      : obj && typeof obj.error === "string" && obj.error.length > 0
        ? humanizeErrorCode(obj.error)
        : `HTTP ${res.status}`;
    throw new ApiClientError(res.status, msg, parsed);
  }
  return parsed as T;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export const apiClient = {
  createSubscription(
    body: CreateSubscriptionRequest,
  ): Promise<CreateSubscriptionResponse> {
    return request("/api/subscriptions", { method: "POST", body });
  },

  getSubscription(id: string): Promise<SubscriptionResponse> {
    return request(`/api/subscriptions/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
  },

  updateSubscription(
    id: string,
    body: UpdateSubscriptionRequest,
  ): Promise<SubscriptionResponse> {
    return request(`/api/subscriptions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
    });
  },

  deleteSubscription(id: string): Promise<DeleteSubscriptionResponse> {
    return request(`/api/subscriptions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  // Validators
  getValidatorEvents(
    id: string,
    opts?: { limit?: number; network?: string },
  ): Promise<ValidatorEventsResponse> {
    const qs = new URLSearchParams();
    if (opts?.limit) qs.set("limit", String(opts.limit));
    if (opts?.network) qs.set("network", opts.network);
    const tail = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/api/validators/${encodeURIComponent(id)}/events${tail}`, {
      cache: "no-store",
    });
  },

  // Channels
  testChannel(body: ChannelTestRequest): Promise<ChannelTestResponse> {
    return request("/api/channels/test", { method: "POST", body });
  },

  testChannelSimple(args: {
    channel: unknown;
    eventType?: ChannelTestRequest["eventType"];
  }): Promise<ChannelTestResponse> {
    return request("/api/channels/test", {
      method: "POST",
      body: { channel: args.channel, eventType: args.eventType ?? "skip" },
    });
  },

  getChannelStatus(
    id: string,
    signal?: AbortSignal,
  ): Promise<ChannelStatusResponse> {
    return request(`/api/channels/${encodeURIComponent(id)}/status`, {
      signal,
      cache: "no-store",
    });
  },

  // Telegram
  pairTelegram(body: TelegramPairRequest): Promise<TelegramPairResponse> {
    return request("/api/telegram/pair", { method: "POST", body });
  },

  getTelegramPairingStatus(
    token: string,
    signal?: AbortSignal,
  ): Promise<TelegramPairingStatusResponse> {
    return request(
      `/api/telegram/status?token=${encodeURIComponent(token)}`,
      { signal, cache: "no-store" },
    );
  },

  testTelegramPairing(
    body:
      | ({ token: string } & TelegramTestExtras)
      | ({ channelId: string } & TelegramTestExtras),
  ): Promise<ChannelTestResponse> {
    return request("/api/telegram/test", { method: "POST", body });
  },

  // Wallet auth (Keplr ADR-036)
  getNonce(): Promise<AuthNonceResponse> {
    return request("/api/auth/nonce", { cache: "no-store" });
  },

  verifySignIn(body: AuthVerifyRequest): Promise<AuthVerifyResponse> {
    return request("/api/auth/verify", { method: "POST", body });
  },

  getSession(): Promise<AuthSessionResponse> {
    return request("/api/auth/session", { cache: "no-store" });
  },

  logout(): Promise<{ ok: true }> {
    return request("/api/auth/logout", { method: "POST" });
  },

  // Wallet-scoped subscription views
  getMine(): Promise<MineSubscriptionsResponse> {
    return request("/api/subscriptions/mine", { cache: "no-store" });
  },
};
