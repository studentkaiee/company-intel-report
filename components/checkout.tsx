"use client";

import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useCallback } from "react";

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

export function Checkout({ previewToken }: { previewToken: string }) {
  const fetchClientSecret = useCallback(async () => {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewToken }),
    });
    const json = (await res.json()) as { clientSecret?: string; error?: string };
    if (!res.ok || !json.clientSecret) throw new Error(json.error ?? "Could not start checkout.");
    return json.clientSecret;
  }, [previewToken]);

  return <EmbeddedCheckoutBox fetchClientSecret={fetchClientSecret} />;
}

/** Embedded Checkout for a session the caller already created. */
export function EmbeddedCheckoutBox({ fetchClientSecret }: { fetchClientSecret: () => Promise<string> }) {
  if (!stripePromise) return <p className="text-sm text-red-600">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set.</p>;
  return (
    <div className="rounded-lg border border-line bg-white p-2">
      <EmbeddedCheckoutProvider stripe={stripePromise} options={{ fetchClientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
