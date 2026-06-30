"use client";

import * as React from "react";
import { Check, Loader2, ShieldCheck, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { keplrGetAddress, keplrSign } from "@/lib/keplr";
import { buildSignInMessage } from "@/lib/sign-in-message";
import { chainFor } from "@/lib/chain";
import { useWalletSession } from "@/components/wallet/wallet-session-context";

interface ConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Account/address is the same bech32 across Celestia mainnet + Mocha, so we
// always sign against the mainnet chain-id. Ownership is network-agnostic.
const CHAIN_ID = chainFor("mainnet").cosmosChainId;

export function ConnectDialog({ open, onOpenChange }: ConnectDialogProps): JSX.Element {
  const { setAddress } = useWalletSession();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [whyOpen, setWhyOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setError(null);
      setBusy(false);
      setWhyOpen(false);
    }
  }, [open]);

  async function handleConnect(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const address = await keplrGetAddress(CHAIN_ID);
      const { nonce } = await apiClient.getNonce();
      const message = buildSignInMessage({
        address,
        domain: window.location.host,
        nonce,
      });
      const sig = await keplrSign(CHAIN_ID, address, message);
      const verified = await apiClient.verifySignIn({
        address,
        message,
        signature: sig.signature,
        pubKey: sig.pubKey,
      });
      setAddress(verified.address.toLowerCase());
      onOpenChange(false);
    } catch (err) {
      let msg = "Could not sign in";
      if (err instanceof ApiClientError) {
        msg =
          err.message === "missing_nonce"
            ? "Session timed out. Try signing again."
            : err.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Connect your Celestia wallet</DialogTitle>
          <DialogDescription>
            Sign in with Keplr so your saved alerts follow you across devices.
          </DialogDescription>
        </DialogHeader>

        <TransparencyBlock whyOpen={whyOpen} onToggleWhy={() => setWhyOpen((v) => !v)} />

        {error ? (
          <p className="rounded-sm border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            <Check className="mr-1 inline h-3 w-3 text-success" />
            Off-chain only. No transaction. No funds movement.
          </p>
          <Button type="button" onClick={() => void handleConnect()} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Connect Keplr
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TransparencyBlock({
  whyOpen,
  onToggleWhy,
}: {
  whyOpen: boolean;
  onToggleWhy: () => void;
}): JSX.Element {
  return (
    <div className="space-y-3 border border-foreground/10 bg-foreground/[0.02] p-4 text-sm">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        <p className="leading-snug">
          <span className="font-medium">What we do:</span> use your wallet
          address as a stable label so your saved alerts follow you across
          devices.
        </p>
      </div>
      <div className="flex items-start gap-2">
        <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <p className="leading-snug">
          <span className="font-medium">What we never see:</span> private keys,
          seed phrase, or wallet balance. Your wallet stays in your wallet.
        </p>
      </div>
      <div className="flex items-start gap-2">
        <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <p className="leading-snug">
          <span className="font-medium">No transactions, ever.</span> You sign a
          plain text message off-chain. No funds move. No approvals are granted.
          Nothing is broadcast to the Celestia network.
        </p>
      </div>
      <button
        type="button"
        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        onClick={onToggleWhy}
      >
        {whyOpen ? "Hide" : "Why am I signing?"}
      </button>
      {whyOpen ? (
        <p className="rounded-sm border border-foreground/10 bg-background/50 p-3 text-xs leading-relaxed text-muted-foreground">
          Signing a message proves to our server that you control the wallet
          address. We use the Cosmos ADR-036 off-chain signing standard. You can
          read the entire message in Keplr before signing. The signature only
          authenticates you to this site — it cannot be replayed elsewhere
          because the message includes our domain and a single-use nonce.
        </p>
      ) : null}
    </div>
  );
}
