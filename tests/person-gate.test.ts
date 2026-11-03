import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { PERSON_PRODUCT, createPersonCheckoutSession, evaluatePersonSession, inputHash } from "@/lib/person/gate";
import { PersonInputSchema } from "@/lib/person/schema";
import { evaluateRunAllowance, isPaid } from "@/lib/stripe";
import { PERSONAL_VALUES, validInput } from "./fixtures/person";

const inputs = PersonInputSchema.parse(validInput);
const NOW = 1_800_000_000;

function session(over: Partial<Stripe.Checkout.Session> = {}, runs = "0") {
  return {
    id: "cs_test_abc",
    created: NOW - 60,
    payment_status: "paid",
    metadata: { product: PERSON_PRODUCT, inputHash: inputHash(inputs) },
    payment_intent: { id: "pi_1", metadata: { product: PERSON_PRODUCT, report_runs: runs } },
    ...over,
  } as unknown as Stripe.Checkout.Session;
}

describe("evaluatePersonSession", () => {
  it("allows a paid, fresh person_screen session with matching inputs", () => {
    expect(evaluatePersonSession(session(), inputs, NOW)).toEqual({ ok: true, paymentIntentId: "pi_1", runs: 0 });
  });

  it("refuses unpaid sessions", () => {
    expect(evaluatePersonSession(session({ payment_status: "unpaid" }), inputs, NOW)).toMatchObject({ ok: false, status: 402 });
  });

  it("refuses the wrong product, including company reports", () => {
    const company = session({ metadata: { product: "company_report", uen: "1", company_name: "X", website: "" } });
    expect(evaluatePersonSession(company, inputs, NOW)).toMatchObject({ ok: false, status: 403 });
    expect(evaluatePersonSession(session({ metadata: {} }), inputs, NOW)).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses sessions older than 24 hours", () => {
    expect(evaluatePersonSession(session({ created: NOW - 24 * 3600 - 1 }), inputs, NOW)).toMatchObject({ ok: false, status: 410 });
    expect(evaluatePersonSession(session({ created: NOW - 24 * 3600 + 60 }), inputs, NOW)).toMatchObject({ ok: true });
  });

  it("refuses inputs that don't match the paid-for hash", () => {
    const other = PersonInputSchema.parse({ ...validInput, fullName: "Lim Wei Ming" });
    expect(evaluatePersonSession(session(), other, NOW)).toMatchObject({ ok: false, status: 403 });
  });

  it("caps runs per purchase", () => {
    expect(evaluatePersonSession(session({}, "2"), inputs, NOW)).toMatchObject({ ok: true, runs: 2 });
    expect(evaluatePersonSession(session({}, "3"), inputs, NOW)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("product separation", () => {
  it("company report gating refuses person_screen sessions", () => {
    expect(evaluateRunAllowance(session())).toMatchObject({ ok: false, status: 403 });
  });

  it("company PDF paid check refuses person_screen sessions", async () => {
    const fake = { checkout: { sessions: { retrieve: vi.fn().mockResolvedValue(session()) } } } as unknown as Stripe;
    expect(await isPaid("cs_test_abc", fake)).toBe(false);
  });
});

describe("createPersonCheckoutSession", () => {
  it("puts only the product and input hash in Stripe metadata, never personal data", async () => {
    const create = vi.fn().mockResolvedValue({ client_secret: "cs_secret" });
    const fake = { checkout: { sessions: { create } } } as unknown as Stripe;
    await createPersonCheckoutSession(inputs, "https://x/person-check/report?session_id={CHECKOUT_SESSION_ID}", fake);

    const params = create.mock.calls[0]![0] as Stripe.Checkout.SessionCreateParams;
    expect(params.metadata).toEqual({ product: PERSON_PRODUCT, inputHash: inputHash(inputs) });
    expect(params.payment_intent_data?.metadata).toEqual({ product: PERSON_PRODUCT, report_runs: "0" });
    const serialized = JSON.stringify(params);
    for (const v of PERSONAL_VALUES) expect(serialized).not.toContain(v);
    expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(2900);
  });
});
