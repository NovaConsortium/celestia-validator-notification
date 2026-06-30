"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface CopyablePubkeyProps {
  value: string;
  className?: string;
}

export function CopyablePubkey({
  value,
  className,
}: CopyablePubkeyProps): JSX.Element {
  const [copied, setCopied] = React.useState(false);
  const truncated =
    value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;

  async function copy(e: React.MouseEvent<HTMLButtonElement>): Promise<void> {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 font-mono text-xs text-muted-foreground",
        className,
      )}
    >
      <span title={value} className="select-all">
        {truncated}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy"}
        className={cn(
          "inline-flex h-5 w-5 cursor-pointer items-center justify-center",
          "border border-transparent transition-colors duration-200",
          "hover:border-foreground/15 hover:text-foreground focus:outline-none",
          "focus-visible:border-primary/60 focus-visible:text-primary",
        )}
      >
        {copied ? (
          <Check className="h-3 w-3 text-success" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </button>
    </div>
  );
}
