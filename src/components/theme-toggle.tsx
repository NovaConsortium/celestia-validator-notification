"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }): JSX.Element {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "group relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/70",
        "bg-card/40 text-foreground/70 backdrop-blur transition-colors duration-200",
        "hover:border-primary/45 hover:text-foreground",
        className,
      )}
    >
      {/* Render nothing theme-specific until mounted to avoid a hydration flash. */}
      <Sun
        className={cn(
          "h-4 w-4 transition-all duration-300 ease-out-quint",
          mounted && isDark
            ? "scale-0 -rotate-90 opacity-0"
            : "scale-100 rotate-0 opacity-100",
        )}
      />
      <Moon
        className={cn(
          "absolute h-4 w-4 transition-all duration-300 ease-out-quint",
          mounted && isDark
            ? "scale-100 rotate-0 opacity-100"
            : "scale-0 rotate-90 opacity-0",
        )}
      />
    </button>
  );
}
