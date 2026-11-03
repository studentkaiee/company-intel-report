import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERSONAL_VALUES, validInput } from "./fixtures/person";

// Fake Stripe: the route and lib/stripe construct `new Stripe(key)`, so mock the package itself.
const stripeState = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  updates: [] as { id: string; params: { metadata: Record<string, string> } }[],
  refunds: [] as unknown[],
}));
vi.mock("stripe", () => ({
  default: class {
    checkout = { sessions: { retrieve: async () => stripeState.session } };
    paymentIntents = {
      retrieve: async () => (stripeState.session as { payment_intent: unknown }).payment_intent,
      update: async (id: string, params: { metadata: Record<string, string> }) => {
        stripeState.updates.push({ id, params });
        return {};
      },
    };
    refunds = { create: async (p: unknown) => stripeState.refunds.push(p) };
  },
}));

const research = vi.hoisted(() => ({ impl: null as null | (() => Promise<unknown>) }));
vi.mock("@/lib/person/research", () => ({ researchPerson: () => research.impl!() }));

import { POST } from "@/app/api/person-report/route";
import { readNdjson, type ProgressEvent } from "@/lib/ndjson";
import { inputHash } from "@/lib/person/gate";
import { verifyReportSignature } from "@/lib/person/report";
import { PersonInputSchema, type PersonReportPayload } from "@/lib/person/schema";

const inputs = PersonInputSchema.parse(validInput);

function paidSession(over: Record<string, unknown> = {}, runs = "0") {
  return {
    id: "cs_test_abcdefghijkl",
    created: Math.floor(Date.now() / 1000) - 60,
    payment_status: "paid",
    metadata: { product: "person_screen", inputHash: inputHash(inputs) },
    payment_intent: { id: "pi_1", metadata: { product: "person_screen", report_runs: runs } },
    ...over,
  };
}

const call = (body: unknown) =>
  POST(new Request("http://localhost/api/person-report", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

async function events(res: Response) {
  const out: ProgressEvent<PersonReportPayload>[] = [];
  await readNdjson<PersonReportPayload>(res, (e) => out.push(e));
  return out;
}

let info: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stripeState.session = paidSession();
  stripeState.updates = [];
  stripeState.refunds = [];
  research.impl = async () => ({
    findings: [],
    searchesRun: ["Tan Wei Ming site:straitstimes.com"],
    overallNote: "No relevant reports found.",
  });
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/person-report", () => {
  it("returns a signed report for a paid session, and keeps personal data out of logs and Stripe", async () => {
    const res = await call({ sessionId: "cs_test_abcdefghijkl", inputs: validInput });
    expect(res.status).toBe(200);
    const done = (await events(res)).find((e) => e.type === "done");
    expect(done?.type).toBe("done");
    const payload = (done as { data: PersonReportPayload }).data;
    expect(verifyReportSignature(payload.report, payload.signature)).not.toBeNull();
    expect(payload.report.subject.fullName).toBe("Tan Wei Ming");

    expect(stripeState.updates[0]!.params.metadata).toEqual({ report_runs: "1" });
    const sentToStripe = JSON.stringify(stripeState.updates);
    const logged = JSON.stringify([...info.mock.calls, ...error.mock.calls]);
    for (const v of PERSONAL_VALUES) {
      expect(sentToStripe).not.toContain(v);
      expect(logged).not.toContain(v);
    }
    expect(logged).toContain("person_screen");
  });

  it.each([
    ["unpaid", { payment_status: "unpaid" }, 402],
    ["wrong product", { metadata: { product: "company_report" } }, 403],
    ["expired", { created: Math.floor(Date.now() / 1000) - 25 * 3600 }, 410],
  ])("refuses %s sessions before doing any research", async (_name, over, status) => {
    stripeState.session = paidSession(over);
    research.impl = async () => {
      throw new Error("research must not run");
    };
    const res = await call({ sessionId: "cs_test_abcdefghijkl", inputs: validInput });
    expect(res.status).toBe(status);
    expect(stripeState.updates).toHaveLength(0);
  });

  it("refuses inputs that don't match what was paid for", async () => {
    const res = await call({ sessionId: "cs_test_abcdefghijkl", inputs: { ...validInput, dob: "1981-05-17" } });
    expect(res.status).toBe(403);
  });

  it("rejects ID-number parameters outright", async () => {
    const res = await call({ sessionId: "cs_test_abcdefghijkl", inputs: { ...validInput, nric: "S1234567D" } });
    expect(res.status).toBe(400);
  });

  it("on failure with attempts left, reports a retryable error and no refund", async () => {
    research.impl = async () => {
      throw new Error("boom");
    };
    const evs = await events(await call({ sessionId: "cs_test_abcdefghijkl", inputs: validInput }));
    expect(evs.at(-1)).toMatchObject({ type: "error", final: false });
    expect(stripeState.refunds).toHaveLength(0);
  });

  it("refunds automatically when the last attempt fails", async () => {
    stripeState.session = paidSession({}, "2");
    research.impl = async () => {
      throw new Error("boom");
    };
    const evs = await events(await call({ sessionId: "cs_test_abcdefghijkl", inputs: validInput }));
    expect(evs.at(-1)).toMatchObject({ type: "error", final: true });
    expect(String((evs.at(-1) as { message: string }).message)).toMatch(/refunded/);
    expect(stripeState.refunds).toHaveLength(1);
  });
});
