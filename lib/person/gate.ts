import type Stripe from "stripe";
import { MAX_REPORT_RUNS, stripe } from "../stripe";
import { hmacHex, safeEqual } from "./canonical";
import { personEnv } from "./env";
import type { PersonInput } from "./schema";

export const PERSON_PRODUCT = "person_screen";
/** Sessions older than this can no longer produce a report. */
export const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

/** HMAC of the canonical, validated inputs. The only trace of the inputs that leaves the browser and server. */
export const inputHash = (inputs: PersonInput, secret?: string) => hmacHex("input", inputs, secret);

/**
 * Creates an Embedded Checkout Session. Metadata holds only the product and the input hash:
 * no name, date of birth or any other personal data goes to Stripe.
 */
export async function createPersonCheckoutSession(
  inputs: PersonInput,
  returnUrl: string,
  s: Stripe = stripe(),
): Promise<{ clientSecret: string }> {
  const metadata = { product: PERSON_PRODUCT, inputHash: inputHash(inputs) };
  const session = await s.checkout.sessions.create({
    ui_mode: "embedded_page",
    mode: "payment",
    currency: "sgd",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "sgd",
          unit_amount: personEnv().PERSON_SCREEN_PRICE_SGD_CENTS,
          product_data: {
            name: "Individual Legal Screen",
            description: "Singapore court and regulator records, other public legal sources and sanctions lists, delivered as a PDF.",
          },
        },
      },
    ],
    metadata,
    payment_intent_data: { metadata: { product: PERSON_PRODUCT, report_runs: "0" } },
    return_url: returnUrl,
  });
  if (!session.client_secret) throw new Error("Stripe did not return a client secret");
  return { clientSecret: session.client_secret };
}

export type PersonAllowance =
  | { ok: true; paymentIntentId: string; runs: number }
  | { ok: false; status: 402 | 403 | 409 | 410; reason: string };

/** Pure gating decision for a session retrieved server-side with `expand: ['payment_intent']`. */
export function evaluatePersonSession(
  session: Stripe.Checkout.Session,
  inputs: PersonInput,
  nowSeconds = Math.floor(Date.now() / 1000),
  secret?: string,
): PersonAllowance {
  if (session.payment_status !== "paid") return { ok: false, status: 402, reason: "Payment has not been completed." };
  if (session.metadata?.product !== PERSON_PRODUCT) {
    return { ok: false, status: 403, reason: "This payment is not for an Individual Legal Screen." };
  }
  if (nowSeconds - session.created > SESSION_MAX_AGE_SECONDS) {
    return { ok: false, status: 410, reason: "This purchase is more than 24 hours old and can no longer run a screen." };
  }
  if (!safeEqual(session.metadata.inputHash ?? "", inputHash(inputs, secret))) {
    return {
      ok: false,
      status: 403,
      reason: "The details in this browser don't match the details that were paid for. Open the page in the same tab you paid from.",
    };
  }
  const pi = session.payment_intent;
  if (!pi || typeof pi === "string") {
    return { ok: false, status: 409, reason: "Payment details are not available yet. Please retry in a moment." };
  }
  const runs = Number.parseInt(pi.metadata?.report_runs ?? "0", 10);
  const safeRuns = Number.isFinite(runs) && runs >= 0 ? runs : MAX_REPORT_RUNS;
  if (safeRuns >= MAX_REPORT_RUNS) {
    return { ok: false, status: 403, reason: `This purchase has already run ${MAX_REPORT_RUNS} screens, which is the limit.` };
  }
  return { ok: true, paymentIntentId: pi.id, runs: safeRuns };
}

/** Confirms payment with Stripe and records one more run before the expensive work starts. */
export async function claimPersonRun(sessionId: string, inputs: PersonInput, s: Stripe = stripe()): Promise<PersonAllowance> {
  const session = await s.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
  const allowance = evaluatePersonSession(session, inputs);
  if (!allowance.ok) return allowance;
  await s.paymentIntents.update(allowance.paymentIntentId, { metadata: { report_runs: String(allowance.runs + 1) } });
  return { ...allowance, runs: allowance.runs + 1 };
}
