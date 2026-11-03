import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { MAX_REPORT_RUNS, claimReportRun, evaluateRunAllowance, refundIfExhausted, shouldRefund } from "@/lib/stripe";

const meta = { uen: "201912345K", company_name: "ACME PTE. LTD.", website: "https://acme.sg" };

function session(overrides: Partial<Stripe.Checkout.Session> = {}, runs: string | undefined = "0") {
  return {
    id: "cs_test_abc",
    payment_status: "paid",
    metadata: meta,
    payment_intent: { id: "pi_123", metadata: runs === undefined ? {} : { report_runs: runs } },
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

describe("evaluateRunAllowance", () => {
  it("allows a paid session with runs remaining", () => {
    expect(evaluateRunAllowance(session())).toEqual({
      ok: true,
      paymentIntentId: "pi_123",
      runs: 0,
      meta,
      email: null,
      succeeded: false,
    });
  });

  it("passes through the buyer email and earlier success", () => {
    const s = session({ customer_details: { email: "a@b.sg" } as Stripe.Checkout.Session.CustomerDetails });
    (s.payment_intent as Stripe.PaymentIntent).metadata.report_succeeded = "true";
    expect(evaluateRunAllowance(s)).toMatchObject({ ok: true, email: "a@b.sg", succeeded: true });
  });

  it("refuses unpaid sessions", () => {
    const r = evaluateRunAllowance(session({ payment_status: "unpaid" }));
    expect(r).toMatchObject({ ok: false, status: 402 });
  });

  it("refuses when the payment intent was not expanded", () => {
    expect(evaluateRunAllowance(session({ payment_intent: "pi_123" }))).toMatchObject({ ok: false, status: 409 });
  });

  it(`refuses at ${MAX_REPORT_RUNS} runs`, () => {
    expect(evaluateRunAllowance(session({}, String(MAX_REPORT_RUNS - 1)))).toMatchObject({ ok: true });
    expect(evaluateRunAllowance(session({}, String(MAX_REPORT_RUNS)))).toMatchObject({ ok: false, status: 403 });
  });

  it("treats missing run metadata as zero and garbage as exhausted", () => {
    expect(evaluateRunAllowance(session({}, undefined))).toMatchObject({ ok: true, runs: 0 });
    expect(evaluateRunAllowance(session({}, "abc"))).toMatchObject({ ok: false, status: 403 });
    expect(evaluateRunAllowance(session({}, "-1"))).toMatchObject({ ok: false, status: 403 });
  });
});

describe("claimReportRun", () => {
  function fakeStripe(s: Stripe.Checkout.Session) {
    const retrieve = vi.fn().mockResolvedValue(s);
    const update = vi.fn().mockResolvedValue({});
    return {
      client: { checkout: { sessions: { retrieve } }, paymentIntents: { update } } as unknown as Stripe,
      retrieve,
      update,
    };
  }

  it("retrieves the session server-side with the payment intent and increments the counter", async () => {
    const f = fakeStripe(session({}, "1"));
    const r = await claimReportRun("cs_test_abc", f.client);
    expect(f.retrieve).toHaveBeenCalledWith("cs_test_abc", { expand: ["payment_intent"] });
    expect(f.update).toHaveBeenCalledWith("pi_123", { metadata: { report_runs: "2" } });
    expect(r).toMatchObject({ ok: true, runs: 2 });
  });

  it("does not touch metadata when refusing", async () => {
    const f = fakeStripe(session({ payment_status: "unpaid" }));
    expect(await claimReportRun("cs_test_abc", f.client)).toMatchObject({ ok: false });
    expect(f.update).not.toHaveBeenCalled();
  });
});

describe("refund on repeated failure", () => {
  it("refunds only after the last run fails with nothing delivered", () => {
    expect(shouldRefund(MAX_REPORT_RUNS - 1, false)).toBe(false);
    expect(shouldRefund(MAX_REPORT_RUNS, false)).toBe(true);
    expect(shouldRefund(MAX_REPORT_RUNS, true)).toBe(false);
  });

  function fakeStripe(piMetadata: Record<string, string>) {
    const retrieve = vi.fn().mockResolvedValue({ id: "pi_123", metadata: piMetadata });
    const update = vi.fn().mockResolvedValue({});
    const create = vi.fn().mockResolvedValue({ id: "re_1" });
    return {
      client: { paymentIntents: { retrieve, update }, refunds: { create } } as unknown as Stripe,
      retrieve,
      update,
      create,
    };
  }

  it("issues an idempotent full refund and marks the payment", async () => {
    const f = fakeStripe({ report_runs: String(MAX_REPORT_RUNS) });
    expect(await refundIfExhausted("pi_123", MAX_REPORT_RUNS, f.client)).toBe(true);
    expect(f.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_123" }),
      { idempotencyKey: "report-refund-pi_123" },
    );
    expect(f.update).toHaveBeenCalledWith("pi_123", { metadata: { refunded: "true" } });
  });

  it("does not refund while runs remain", async () => {
    const f = fakeStripe({});
    expect(await refundIfExhausted("pi_123", MAX_REPORT_RUNS - 1, f.client)).toBe(false);
    expect(f.retrieve).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });

  it("does not refund if another run succeeded or it was already refunded", async () => {
    const cases: Record<string, string>[] = [{ report_succeeded: "true" }, { refunded: "true" }];
    for (const meta of cases) {
      const f = fakeStripe(meta);
      expect(await refundIfExhausted("pi_123", MAX_REPORT_RUNS, f.client)).toBe(false);
      expect(f.create).not.toHaveBeenCalled();
    }
  });
});
