"use client";

import * as React from "react";

interface CaptchaProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
}

declare global {
  interface Window {
    hcaptcha?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
        },
      ) => string;
      reset: (id?: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://js.hcaptcha.com/1/api.js?render=explicit";

/**
 * hCaptcha widget. If `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` is unset (local
 * dev), renders a "captcha disabled" stub and emits a deterministic
 * token so submission isn't blocked. Avoids the need for the
 * `@hcaptcha/react-hcaptcha` dependency.
 */
export function Captcha({ onVerify, onExpire }: CaptchaProps): JSX.Element {
  const siteKey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;
  const ref = React.useRef<HTMLDivElement | null>(null);
  const widgetIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!siteKey) {
      // Auto-verify in dev with a sentinel token.
      onVerify("dev-captcha-disabled");
      return;
    }

    const el = ref.current;
    if (!el) return;

    function tryRender(): void {
      const cur = ref.current;
      if (!cur) return;
      if (window.hcaptcha && widgetIdRef.current === null) {
        widgetIdRef.current = window.hcaptcha.render(cur, {
          sitekey: siteKey ?? "",
          callback: (token: string) => onVerify(token),
          "expired-callback": () => onExpire?.(),
        });
      }
    }

    if (window.hcaptcha) {
      tryRender();
      return;
    }

    let cancelled = false;
    const existing = document.querySelector(`script[src^="${SCRIPT_SRC}"]`);
    if (!existing) {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => {
        if (!cancelled) tryRender();
      };
      document.head.appendChild(s);
    } else {
      const id = window.setInterval(() => {
        if (cancelled) return;
        if (window.hcaptcha) {
          window.clearInterval(id);
          tryRender();
        }
      }, 200);
      window.setTimeout(() => window.clearInterval(id), 10_000);
    }

    return () => {
      cancelled = true;
    };
  }, [siteKey, onVerify, onExpire]);

  if (!siteKey) {
    return (
      <p className="text-xs text-muted-foreground">
        Captcha disabled (set <code>NEXT_PUBLIC_HCAPTCHA_SITE_KEY</code> to enable).
      </p>
    );
  }

  return <div ref={ref} />;
}
