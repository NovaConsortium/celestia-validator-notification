"use client";

import * as React from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  HelpCircle,
  Loader2,
  Mail,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TemplateEditor } from "@/components/template-editor";
import { TelegramPairButton } from "@/components/telegram-pair-button";
import { EmailVerify } from "@/components/email-verify";
import { apiClient, ApiClientError } from "@/lib/api-client";
import {
  DEFAULT_TEMPLATES,
  DEFAULT_TITLE_TEMPLATES,
  DEFAULT_SUBJECT_TEMPLATES,
} from "@/channels/templates/defaults";
import { cn } from "@/lib/utils";
import type { ChannelInput } from "@/lib/api-types";
import { ALL_EVENT_GROUPS, type ChannelType } from "@/types/channels";
import type { EventType } from "@/types/events";

// ponytail: template customization UI is built but hidden. Flip to true to
// re-enable the "Customize messages" panel — backend already accepts templates.
const SHOW_TEMPLATE_EDITOR = false;

const EVENT_TYPES: EventType[] = [
  "skip",
  "offline",
  "recovered",
  "delegate",
  "undelegate",
  "commission_changed",
];

const CHANNEL_LABEL: Record<ChannelType, string> = {
  discord: "Discord",
  slack: "Slack",
  telegram: "Telegram",
  pagerduty: "PagerDuty",
  email: "Email",
};

interface ChannelCardProps {
  channel: ChannelInput;
  paired?: boolean;
  /** Subscription owning this channel - needed for pre-save Telegram pairing. */
  subscriptionId?: string;
  onChange: (next: ChannelInput) => void;
  onRemove: () => void;
}

type TestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

export function ChannelCard({
  channel,
  paired,
  subscriptionId,
  onChange,
  onRemove,
}: ChannelCardProps): JSX.Element {
  const [showTemplates, setShowTemplates] = React.useState(false);
  // Tracks which event-type tab is active so "Send test" fires the
  // currently-shown template, not always `skip`.
  const [activeEvent, setActiveEvent] = React.useState<EventType>("skip");
  const [testState, setTestState] = React.useState<TestState>({ kind: "idle" });
  // Mirror Telegram pairing status locally so a session-time pair flips
  // testable on without needing a page reload (the `paired` prop only
  // reflects the server snapshot from initial load).
  const [pairedLocal, setPairedLocal] = React.useState<boolean>(Boolean(paired));
  React.useEffect(() => {
    if (paired) setPairedLocal(true);
  }, [paired]);

  React.useEffect(() => {
    if (testState.kind !== "ok") return;
    const t = setTimeout(() => setTestState({ kind: "idle" }), 2500);
    return () => clearTimeout(t);
  }, [testState.kind]);

  function patchConfig<K extends string>(k: K, v: unknown): void {
    onChange({ ...channel, config: { ...channel.config, [k]: v } });
  }

  async function runTest(): Promise<void> {
    setTestState({ kind: "loading" });
    try {
      const res =
        channel.type === "telegram" && channel.id
          ? await apiClient.testTelegramPairing({
              channelId: channel.id,
              eventType: activeEvent,
              ...(channel.config.templates
                ? { templates: channel.config.templates }
                : {}),
              ...(channel.config.rawTemplate !== undefined
                ? { rawTemplate: channel.config.rawTemplate }
                : {}),
            })
          : await apiClient.testChannelSimple({ channel, eventType: activeEvent });
      setTestState(
        res.ok
          ? { kind: "ok" }
          : { kind: "error", message: res.error ?? "Test failed" },
      );
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Test failed";
      setTestState({ kind: "error", message: msg });
    }
  }

  // Telegram is testable only after pairing completes (has channel.id +
  // server-confirmed chatId). Email only after the address is either
  // saved (channel.id) or freshly verified (verifiedToken in config) —
  // server enforces the same gate, this just hides the button.
  const isEmail = channel.type === "email";
  const emailTestable =
    !isEmail || Boolean(channel.id) || Boolean(channel.config.verifiedToken);
  const testable =
    (channel.type !== "telegram" || (Boolean(channel.id) && pairedLocal)) &&
    emailTestable;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 px-5 py-4">
        <CardTitle className="text-lg">{CHANNEL_LABEL[channel.type]}</CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label="Remove channel"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-3 px-5 pb-4">
        <ChannelFields
          channel={channel}
          paired={pairedLocal}
          subscriptionId={subscriptionId}
          patchConfig={patchConfig}
          onChange={onChange}
          onTelegramPaired={() => setPairedLocal(true)}
        />

        {testState.kind === "error" ? (
          <p className="animate-shake text-xs text-destructive">{testState.message}</p>
        ) : null}

        <div className="flex items-center justify-end gap-4">
          {SHOW_TEMPLATE_EDITOR ? (
            <button
              type="button"
              onClick={() => setShowTemplates((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {showTemplates ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              Customize messages
            </button>
          ) : null}
          {testable ? (
            <button
              type="button"
              onClick={runTest}
              disabled={testState.kind === "loading" || testState.kind === "ok"}
              className={cn(
                "inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-100",
                testState.kind === "ok" && "text-emerald-600 hover:text-emerald-600",
              )}
            >
              {testState.kind === "loading" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : testState.kind === "ok" ? (
                <Check className="h-3 w-3 animate-pop" />
              ) : null}
              {testState.kind === "loading"
                ? "Sending"
                : testState.kind === "ok"
                  ? "Test sent"
                  : "Send test"}
            </button>
          ) : null}
        </div>

        {SHOW_TEMPLATE_EDITOR && showTemplates ? (
          <Tabs
            value={activeEvent}
            onValueChange={(v) => setActiveEvent(v as EventType)}
            className="w-full"
          >
            <TabsList className="flex flex-wrap gap-1">
              {EVENT_TYPES.map((e) => (
                <TabsTrigger key={e} value={e} className="capitalize text-xs">
                  {e.replace("_", " ")}
                </TabsTrigger>
              ))}
            </TabsList>
            {EVENT_TYPES.map((e) => (
              <TabsContent key={e} value={e} className="pt-4">
                <TemplateEditor
                  eventType={e}
                  channelType={channel.type}
                  defaultValue={DEFAULT_TEMPLATES[e]}
                  value={channel.config.templates?.[e] ?? DEFAULT_TEMPLATES[e]}
                  onChange={(next) => {
                    const templates = { ...(channel.config.templates ?? {}) };
                    templates[e] = next;
                    onChange({
                      ...channel,
                      config: { ...channel.config, templates },
                    });
                  }}
                  title={
                    channel.type === "email"
                      ? {
                          value:
                            channel.config.subjectTemplates?.[e] ??
                            DEFAULT_SUBJECT_TEMPLATES[e],
                          defaultValue: DEFAULT_SUBJECT_TEMPLATES[e],
                          label: "Subject",
                          onChange: (next) => {
                            const subjectTemplates = {
                              ...(channel.config.subjectTemplates ?? {}),
                            };
                            subjectTemplates[e] = next;
                            onChange({
                              ...channel,
                              config: {
                                ...channel.config,
                                subjectTemplates,
                              },
                            });
                          },
                        }
                      : channel.type === "discord" ||
                          channel.type === "slack" ||
                          channel.type === "telegram"
                        ? {
                            value:
                              channel.config.titleTemplates?.[e] ??
                              DEFAULT_TITLE_TEMPLATES[e],
                            defaultValue: DEFAULT_TITLE_TEMPLATES[e],
                            onChange: (next) => {
                              const titleTemplates = {
                                ...(channel.config.titleTemplates ?? {}),
                              };
                              titleTemplates[e] = next;
                              onChange({
                                ...channel,
                                config: {
                                  ...channel.config,
                                  titleTemplates,
                                },
                              });
                            },
                          }
                        : undefined
                  }
                />
              </TabsContent>
            ))}
          </Tabs>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ChannelFields({
  channel,
  paired,
  subscriptionId,
  patchConfig,
  onChange,
  onTelegramPaired,
}: {
  channel: ChannelInput;
  paired?: boolean;
  subscriptionId?: string;
  patchConfig: (k: string, v: unknown) => void;
  onChange: (next: ChannelInput) => void;
  onTelegramPaired?: () => void;
}): JSX.Element {
  switch (channel.type) {
    case "discord":
    case "slack":
      return (
        <SecretField
          label="Webhook URL"
          value={channel.config.webhookUrl ?? ""}
          onChange={(v) => patchConfig("webhookUrl", v)}
          placeholder={
            channel.type === "discord"
              ? "https://discord.com/api/webhooks/…"
              : "https://hooks.slack.com/services/…"
          }
          help={
            channel.type === "discord" ? <DiscordHelpDialog /> : <SlackHelpDialog />
          }
        />
      );

    case "telegram":
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Open the bot and send <code>/start</code>, then we&apos;ll auto-fill
            the chat id.
          </p>
          <TelegramPairButton
            channelId={channel.id}
            subscriptionId={subscriptionId}
            paired={paired}
            pairedTitle={channel.config.chatTitle}
            existingToken={channel.config.pairingToken}
            onChannelId={(id) => onChange({ ...channel, id })}
            onPaired={(id) => {
              onChange({ ...channel, id });
              onTelegramPaired?.();
            }}
            onToken={(token) =>
              onChange({
                ...channel,
                config: { ...channel.config, pairingToken: token },
              })
            }
          />
        </div>
      );

    case "pagerduty":
      return (
        <SecretField
          label="Routing key (Events API v2)"
          value={channel.config.routingKey ?? ""}
          onChange={(v) => patchConfig("routingKey", v)}
          placeholder="32-char integration key"
          help={<PagerDutyHelpDialog />}
        />
      );

    case "email":
      return <EmailChannelFields channel={channel} onChange={onChange} />;
  }
}

function SecretField({
  label,
  value,
  onChange,
  placeholder,
  help,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  help?: React.ReactNode;
}): JSX.Element {
  const [shown, setShown] = React.useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-end justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{label}</span>
          {value ? (
            <button
              type="button"
              onClick={() => setShown((s) => !s)}
              aria-label={shown ? `Hide ${label}` : `Show ${label}`}
              title={shown ? `Hide ${label}` : `Show ${label}`}
              className="text-muted-foreground hover:text-foreground"
            >
              {shown ? (
                <Eye className="h-3.5 w-3.5" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" />
              )}
            </button>
          ) : null}
        </div>
        {help}
      </div>
      <Input
        type={shown || !value ? "text" : "password"}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function EmailChannelFields({
  channel,
  onChange,
}: {
  channel: ChannelInput;
  onChange: (next: ChannelInput) => void;
}): JSX.Element {
  // Manage view of an existing channel: trust the prior verification
  // unless the user edits the address (EmailVerify clears its own
  // verified state on edit; PATCH backend skips token check when the
  // saved email is unchanged).
  const initiallyVerified = Boolean(channel.id && channel.config.to);

  return (
    <div className="space-y-3">
      <EmailVerify
        initialEmail={channel.config.to ?? ""}
        initiallyVerified={initiallyVerified}
        onVerified={(email, token) =>
          onChange({
            ...channel,
            config: { ...channel.config, to: email, verifiedToken: token },
          })
        }
        onEmailInvalidated={() => {
          const next = { ...channel.config };
          delete next.verifiedToken;
          delete next.to;
          onChange({ ...channel, config: next });
        }}
      />
    </div>
  );
}

function DiscordHelpDialog(): JSX.Element {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <HelpCircle className="h-3 w-3" />
          How do I get a Discord webhook?
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discord webhook URL</DialogTitle>
          <DialogDescription>
            Webhooks are per-channel. Anyone with the URL can post to that
            channel, so keep it private.
          </DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            In your Discord server, open the target channel and click the gear
            icon (<strong>Edit Channel</strong>).
          </li>
          <li>
            Go to <strong>Integrations</strong> → <strong>Webhooks</strong> →{" "}
            <strong>New Webhook</strong>.
          </li>
          <li>
            Optionally rename the bot and set an avatar, then click{" "}
            <strong>Copy Webhook URL</strong>.
          </li>
          <li>Paste the URL into the Webhook URL field above.</li>
        </ol>
        <p className="text-xs text-muted-foreground">
          You need Manage Webhooks permission on the channel.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function SlackHelpDialog(): JSX.Element {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <HelpCircle className="h-3 w-3" />
          How do I get a Slack webhook?
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Slack incoming webhook</DialogTitle>
          <DialogDescription>
            One webhook posts to one channel. Re-run the steps for additional
            channels.
          </DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            Go to{" "}
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              api.slack.com/apps
            </a>{" "}
            → <strong>Create an App</strong> →{" "}
            <strong>From scratch</strong>. Pick a name and workspace, then
            click <strong>Create App</strong>.
          </li>
          <li>
            In the app&apos;s sidebar open <strong>Incoming Webhooks</strong>{" "}
            and toggle <strong>Activate Incoming Webhooks</strong> on.
          </li>
          <li>
            Scroll down and click <strong>Add New Webhook to Workspace</strong>
            , choose the target channel, then click <strong>Allow</strong>.
          </li>
          <li>
            Copy the webhook URL (starts with{" "}
            <code className="mx-1 rounded bg-muted px-1">
              https://hooks.slack.com/services/…
            </code>
            ) and paste it above.
          </li>
        </ol>
        <p className="text-xs text-muted-foreground">
          Ignore the <strong>Generate Token</strong> button on the apps list —
          that&apos;s for App Configuration Tokens, not webhooks. Workspace
          admins may need to approve the app before install.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function PagerDutyHelpDialog(): JSX.Element {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <HelpCircle className="h-3 w-3" />
          How do I find my routing key?
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>PagerDuty integration key</DialogTitle>
          <DialogDescription>
            Create an Events API v2 integration on the service that should receive
            these alerts.
          </DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            In PagerDuty, open <strong>Services → Service Directory</strong> and pick
            the service.
          </li>
          <li>
            Open the <strong>Integrations</strong> tab → <strong>Add an Integration</strong>.
          </li>
          <li>
            Choose <strong>Events API v2</strong> and save. The routing key (a
            32-character hex string) appears next to the integration name.
          </li>
          <li>
            Copy that string into the Routing key field above. We&apos;ll send
            <code className="mx-1 rounded bg-muted px-1">trigger</code> + matching
            <code className="mx-1 rounded bg-muted px-1">resolve</code> events.
          </li>
        </ol>
      </DialogContent>
    </Dialog>
  );
}

export function newChannel(type: ChannelType): ChannelInput {
  // Default to all 4 event groups so the channel auto-receives every
  // alert the user has enabled. They can untick groups via the routing
  // row under each event card.
  return { type, config: {}, enabled: true, events: [...ALL_EVENT_GROUPS] };
}

export const CHANNEL_PALETTE: {
  type: ChannelType;
  label: string;
  hint: string;
  /** Path under /public for an image icon, used when present. */
  iconSrc?: string;
  /** Lucide fallback when no image. */
  Icon?: LucideIcon;
  /** brand color used for the icon tile background tint */
  color: string;
}[] = [
  { type: "discord", label: "Discord", hint: "Webhook", iconSrc: "/discord-icon.png", color: "#5865F2" },
  { type: "slack", label: "Slack", hint: "Webhook", iconSrc: "/slack-icon.png", color: "#E01E5A" },
  { type: "telegram", label: "Telegram", hint: "Bot deep-link", iconSrc: "/telegram-icon.png", color: "#229ED9" },
  { type: "pagerduty", label: "PagerDuty", hint: "Events API v2", iconSrc: "/pagerduty-icon.webp", color: "#06AC38" },
  { type: "email", label: "Email", hint: "Inbox alert", Icon: Mail, color: "#F59E0B" },
];

export function ChannelTypeBadge({ type }: { type: ChannelType }): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground",
      )}
    >
      {CHANNEL_LABEL[type]}
    </span>
  );
}
