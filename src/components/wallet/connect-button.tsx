"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronDown, LogOut, ScrollText, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectDialog } from "@/components/wallet/connect-dialog";
import { useWalletSession } from "@/components/wallet/wallet-session-context";
import { cn } from "@/lib/utils";

export function ConnectButton(): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const { address, logout } = useWalletSession();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [coords, setCoords] = React.useState<{
    top: number;
    left: number;
    width: number;
  }>({ top: 0, left: 0, width: 0 });

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const updateCoords = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ top: r.bottom + 6, left: r.left, width: r.width });
  }, []);

  React.useEffect(() => {
    if (!menuOpen) return;
    updateCoords();
    function onDocClick(e: MouseEvent): void {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setMenuOpen(false);
    }
    function onScrollResize(): void {
      updateCoords();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
    };
  }, [menuOpen, updateCoords]);

  if (!mounted) {
    return (
      <span className="inline-flex h-9 w-32 items-center justify-center border border-foreground/10 text-2xs uppercase tracking-micro text-foreground/40">
        …
      </span>
    );
  }

  if (!address) {
    return (
      <>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
          className="gap-2"
        >
          <Wallet className="h-3.5 w-3.5" />
          Connect Wallet
        </Button>
        <ConnectDialog open={open} onOpenChange={setOpen} />
      </>
    );
  }

  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;

  async function onDisconnect(): Promise<void> {
    setMenuOpen(false);
    await logout();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        className={cn(
          "inline-flex h-9 items-center gap-2 border border-foreground/15 px-3 text-xs font-mono tracking-tight text-foreground/85",
          "transition-colors duration-200 ease-out-quart hover:border-primary/40 hover:text-foreground",
          menuOpen && "border-primary/40 text-foreground",
        )}
        title="Wallet menu"
      >
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
        </span>
        {short}
        <ChevronDown
          className={cn(
            "h-3 w-3 text-foreground/55 transition-transform duration-200 ease-out-quart",
            menuOpen && "rotate-180 text-foreground",
          )}
        />
      </button>

      {menuOpen
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{
                position: "fixed",
                top: coords.top,
                left: coords.left,
                width: coords.width,
                zIndex: 9999,
              }}
              className="origin-top overflow-hidden rounded-xl border border-border bg-popover shadow-[0_24px_60px_-12px_hsl(252_50%_4%_/_0.5)] animate-fade-down"
            >
              <Link
                href="/my-alerts"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-xs text-foreground/85 transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground"
              >
                <ScrollText className="h-3.5 w-3.5" />
                My alerts
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={onDisconnect}
                className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-xs text-destructive/80 transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive"
              >
                <LogOut className="h-3.5 w-3.5" />
                Disconnect
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
