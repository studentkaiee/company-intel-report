import Stripe from "stripe";
import type { UsageTotals } from "./cost";
import { env } from "./env";

export const MAX_REPORT_RUNS = 3;

let client: Stripe | undefined;
export function stripe(): Stripe {
  client ??= new Stripe(env().STRIPE_SECRET_KEY);
  return client;
}

export type ReportMetadata = { uen: string; company_name: string; website: string };

/** Sessions created before products existed have no `product` and are company reports. */
export const COMPANY_PRODUCT = "company_report";

export async function createCheckoutSession(
  meta: ReportMetadata,
  returnUrl: string,
  s: Stripe = stripe(),
): Promise<{ clientSecret: string }> {
  const session = await s.checkout.sessions.create({
    // Stripe's current API version names Embedded Checkout "embedded_page" (formerly "embedded").
    ui_mode: "embedded_page",
    mode: "payment",
    currency: "sgd",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "sgd",
          unit_amount: env().REPORT_PRICE_SGD_CENTS,
          product_data: {
            name: `Company intelligence report: ${meta.company_name}`.slice(0, 250),
            description: "AI-compiled report from public sources, delivered as a cited PDF.",
          },
        },
      },
    ],
    metadata: { ...meta, product: COMPANY_PRODUCT },
    payment_intent_data: { metadata: { ...meta, product: COMPANY_PRODUCT, report_runs: "0" } },
    return_url: returnUrl,
  });
  if (!session.client_secret) throw new Error("Stripe did not return a client secret");
  return { clientSecret: session.client_secret };
}

export type RunAllowance =
  | {
      ok: true;
      paymentIntentId: string;
      runs: number;
      meta: ReportMetadata;
      /** Buyer's email as collected by Stripe Checkout. */
      email: string | null;
      /** Whether an earlier run of this purchase already produced a report. */
      succeeded: boolean;
    }
  | { ok: false; status: 402 | 403 | 409; reason: string };

/** Pure gating decision from a Checkout Session retrieved server-side with `expand: ['payment_intent']`. */
export function evaluateRunAllowance(session: Stripe.Checkout.Session): RunAllowance {
  if (session.payment_status !== "paid") {
    return { ok: false, status: 402, reason: "Payment has not been completed." };
  }
  const product = session.metadata?.product;
  if (product !== undefined && product !== COMPANY_PRODUCT) {
    return { ok: false, status: 403, reason: "This payment is not for a company report." };
  }
  const pi = session.payment_intent;
  if (!pi || typeof pi === "string") {
    return { ok: false, status: 409, reason: "Payment details are not available yet. Please retry in a moment." };
  }
  const runs = Number.parseInt(pi.metadata?.report_runs ?? "0", 10);
  const safeRuns = Number.isFinite(runs) && runs >= 0 ? runs : MAX_REPORT_RUNS;
  if (safeRuns >= MAX_REPORT_RUNS) {
    return {
      ok: false,
      status: 403,
      reason: `This purchase has already generated ${MAX_REPORT_RUNS} reports, which is the limit.`,
    };
  }
  const m = session.metadata ?? {};
  return {
    ok: true,
    paymentIntentId: pi.id,
    runs: safeRuns,
    meta: { uen: m.uen ?? "", company_name: m.company_name ?? "", website: m.website ?? "" },
    email: session.customer_details?.email ?? null,
    succeeded: pi.metadata?.report_succeeded === "true",
  };
}

/** Refund only when the last allowed run has failed and no run ever produced a report. */
export function shouldRefund(runsUsed: number, succeeded: boolean): boolean {
  return runsUsed >= MAX_REPORT_RUNS && !succeeded;
}

export async function recordReportSuccess(paymentIntentId: string, s: Stripe = stripe()): Promise<void> {
  await s.paymentIntents.update(paymentIntentId, { metadata: { report_succeeded: "true" } });
}

/**
 * Metadata recording what this purchase has cost us so far, visible on the payment in the Stripe dashboard.
 * `previous` is the PaymentIntent's current metadata.
 */
export function usageMetadata(previous: Record<string, string>, run: UsageTotals): Record<string, string> {
  const prevCost = Number.parseFloat(previous.cost_usd_total ?? "0");
  const prevSearches = Number.parseInt(previous.web_searches_total ?? "0", 10);
  const total = run.costUsd === null || !Number.isFinite(prevCost) ? null : prevCost + run.costUsd;
  return {
    cost_usd_last_run: run.costUsd === null ? "unknown" : run.costUsd.toFixed(4),
    cost_usd_total: total === null ? "unknown" : total.toFixed(4),
    web_searches_total: String((Number.isFinite(prevSearches) ? prevSearches : 0) + run.webSearches),
    tokens_last_run: `${run.inputTokens} in / ${run.outputTokens} out`,
  };
}

export async function recordRunUsage(paymentIntentId: string, run: UsageTotals, s: Stripe = stripe()): Promise<void> {
  const pi = await s.paymentIntents.retrieve(paymentIntentId);
  await s.paymentIntents.update(paymentIntentId, { metadata: usageMetadata(pi.metadata ?? {}, run) });
}

/**
 * Called after a run fails. If that was the final allowed run and nothing was ever delivered,
 * refunds the payment in full. Returns true when a refund was issued.
 */
export async function refundIfExhausted(paymentIntentId: string, runsUsed: number, s: Stripe = stripe()): Promise<boolean> {
  if (runsUsed < MAX_REPORT_RUNS) return false;
  // Re-read: another run of the same purchase may have succeeded meanwhile.
  const pi = await s.paymentIntents.retrieve(paymentIntentId);
  if (!shouldRefund(runsUsed, pi.metadata?.report_succeeded === "true") || pi.metadata?.refunded === "true") return false;
  await s.refunds.create(
    { payment_intent: paymentIntentId, reason: "requested_by_customer", metadata: { cause: "report_failed" } },
    { idempotencyKey: `report-refund-${paymentIntentId}` },
  );
  await s.paymentIntents.update(paymentIntentId, { metadata: { refunded: "true" } });
  return true;
}

/**
 * Confirms payment with Stripe and records one more report run on the PaymentIntent metadata.
 * Stripe metadata is our only usage store, so the counter is incremented before the expensive work starts.
 */
export async function claimReportRun(sessionId: string, s: Stripe = stripe()): Promise<RunAllowance> {
  const session = await s.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
  const allowance = evaluateRunAllowance(session);
  if (!allowance.ok) return allowance;
  await s.paymentIntents.update(allowance.paymentIntentId, {
    metadata: { report_runs: String(allowance.runs + 1) },
  });
  return { ...allowance, runs: allowance.runs + 1 };
}

/** Read-only paid check (used for PDF rendering, which does not count as a run). */
export async function isPaid(sessionId: string, s: Stripe = stripe()): Promise<boolean> {
  const session = await s.checkout.sessions.retrieve(sessionId);
  const product = session.metadata?.product;
  return session.payment_status === "paid" && (product === undefined || product === COMPANY_PRODUCT);
}
