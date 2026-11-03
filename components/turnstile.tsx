"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

type TurnstileApi = {
  render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void }) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Cloudflare Turnstile widget. `resetKey` changes force a fresh challenge (tokens are single-use). */
export function Turnstile({ onToken, resetKey }: { onToken: (token: string | null) => void; resetKey: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [loaded, setLoaded] = useState(() => typeof window !== "undefined" && !!window.turnstile);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!loaded || !ref.current || !window.turnstile || !siteKey) return;
    const api = window.turnstile;
    widgetId.current = api.render(ref.current, {
      sitekey: siteKey,
      callback: (t) => onToken(t),
      "expired-callback": () => onToken(null),
    });
    return () => {
      if (widgetId.current) api.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [loaded, siteKey, onToken, resetKey]);

  if (!siteKey) return <p className="text-xs text-red-600">NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set.</p>;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setLoaded(true)}
      />
      <div ref={ref} className="min-h-[65px]" />
    </>
  );
}
