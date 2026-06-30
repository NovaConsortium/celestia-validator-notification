"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SubscriptionForm } from "@/components/subscription-form";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import type { ChannelOutput, SubscriptionResponse } from "@/lib/api-types";

interface RevealableSecrets {
  webhookUrl?: string;
  routingKey?: string;
}

interface ManageViewProps {
  initial: SubscriptionResponse;
  validatorName: string | null;
  validatorLogo: string | null;
  /** Map of channelId → owner-only plaintext secrets (webhook url / routing key). */
  revealable?: Record<string, RevealableSecrets>;
}

export function ManageView({
  initial,
  validatorName,
  validatorLogo,
  revealable,
}: ManageViewProps): JSX.Element {
  const router = useRouter();
  const [subscription, setSubscription] = React.useState(initial);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  async function handleDelete(): Promise<void> {
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiClient.deleteSubscription(subscription.id);
      router.push("/my-alerts");
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to delete";
      setDeleteError(msg);
      setDeleting(false);
    }
  }

  const deleteAction = (
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="lg" type="button">
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete subscription?</DialogTitle>
          <DialogDescription>
            This cannot be undone. All channels and message history will be
            removed.
          </DialogDescription>
        </DialogHeader>
        {deleteError ? (
          <p className="text-sm text-destructive">{deleteError}</p>
        ) : null}
        <DialogFooter>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Delete forever
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="space-y-6">
      <ValidatorHero
        name={validatorName}
        logo={validatorLogo}
        validatorId={subscription.validatorId}
        network={subscription.network}
      />

      <ChannelErrors channels={subscription.channels} />

      <SubscriptionForm
        validatorId={subscription.validatorId}
        network={subscription.network}
        subscriptionId={subscription.id}
        initial={subscription}
        revealableSecrets={revealable}
        onSaved={(res) => {
          if ("channels" in res) setSubscription(res as SubscriptionResponse);
        }}
        extraAction={deleteAction}
      />
    </div>
  );
}

function ValidatorHero({
  name,
  logo,
  validatorId,
  network,
}: {
  name: string | null;
  logo: string | null;
  validatorId: string;
  network: string;
}): JSX.Element {
  const initial = (name ?? `V${validatorId}`).trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="flex items-center gap-4">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt=""
          width={56}
          height={56}
          className="h-14 w-14 shrink-0 border border-foreground/10 bg-foreground/[0.04] object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div
          aria-hidden="true"
          className="grid h-14 w-14 shrink-0 place-items-center border border-foreground/10 bg-foreground/[0.04] text-xl font-bold text-foreground/70"
        >
          {initial}
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Manage subscription · {network}
        </p>
        <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">
          {name ?? `Validator ${validatorId}`}
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">#{validatorId}</p>
      </div>
    </div>
  );
}

function ChannelErrors({ channels }: { channels: ChannelOutput[] }): JSX.Element | null {
  const errored = channels.filter((c) => c.lastErrorMsg);
  if (errored.length === 0) return null;
  return (
    <Card className="border-amber-600/40">
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2 text-base text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4" /> Channel delivery errors
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {errored.map((c) => (
            <li key={c.id} className="flex flex-col">
              <span className="font-medium capitalize">{c.type}</span>
              <span className="text-xs text-muted-foreground">
                {c.lastErrorMsg}
                {c.lastErrorAt ? ` · ${relativeTime(c.lastErrorAt)}` : null}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
