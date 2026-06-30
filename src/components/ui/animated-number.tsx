"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type FormatMode = "plain" | "comma";

interface AnimatedNumberProps {
  value: number;
  format?: FormatMode;
  duration?: number;
  fallback?: string;
  suffix?: ReactNode;
}

function format(value: number, mode: FormatMode): string {
  if (mode === "comma") {
    return Math.round(value).toLocaleString("en-US", {
      maximumFractionDigits: 0,
    });
  }
  return Math.round(value).toString();
}

function display(value: number, mode: FormatMode, fallback?: string): string {
  if (value === 0 && fallback !== undefined) return fallback;
  return format(value, mode);
}

const easeOutQuart = (t: number): number => 1 - Math.pow(1 - t, 4);

export function AnimatedNumber({
  value,
  format: mode = "plain",
  duration = 700,
  fallback,
  suffix,
}: AnimatedNumberProps): JSX.Element {
  const nodeRef = useRef<HTMLSpanElement>(null);
  const fromRef = useRef<number>(value);
  const rafRef = useRef<number | null>(null);
  const [lockCh, setLockCh] = useState<number>(() =>
    display(value, mode, fallback).length,
  );

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const from = fromRef.current;
    const to = value;

    const fromText = display(from, mode, fallback);
    const toText = display(to, mode, fallback);
    const maxLen = Math.max(fromText.length, toText.length);
    setLockCh((prev) => (maxLen > prev ? maxLen : prev));

    if (from === to) {
      node.textContent = toText;
      return;
    }

    const start = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutQuart(t);
      const current = from + (to - from) * eased;
      node.textContent = display(current, mode, fallback);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
        rafRef.current = null;
      }
    };

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [value, mode, fallback, duration]);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontVariantNumeric: "tabular-nums",
        minWidth: `${lockCh}ch`,
      }}
    >
      <span ref={nodeRef}>{display(value, mode, fallback)}</span>
      {suffix}
    </span>
  );
}
