import { randomUUID } from "node:crypto";
import { z } from "zod";
import { UsageTracker } from "@/lib/cost";
import { jsonError, parseBody } from "@/lib/http";
import { PublicError, ndjsonResponse, publicErrorMessage } from "@/lib/ndjson";
import { personEnv } from "@/lib/person/env";
import { claimPersonRun } from "@/lib/person/gate";
import { buildPersonReport } from "@/lib/person/report";
import { researchPerson } from "@/lib/person/research";
import { screenSanctions } from "@/lib/person/sanctions";
import { PersonInputSchema, type PersonReportPayload } from "@/lib/person/schema";
import { MAX_REPORT_RUNS, recordReportSuccess, recordRunUsage, refundIfExhausted } from "@/lib/stripe";
import { CheckoutSessionIdSchema } from "@/lib/tokens";

export const runtime = "nodejs";
// Two research calls run in parallel; 300s is the Vercel Hobby limit with fluid compute (raise on Pro).
export const maxDuration = 300;

const BodySchema = z.object({ sessionId: CheckoutSessionIdSchema, inputs: PersonInputSchema });

export async function POST(req: Request) {
  const body = await parseBody(req, BodySchema);
  if (body instanceof Response) return body;
  try {
    personEnv();
  } catch (err) {
    return jsonError(503, publicErrorMessage(err));
  }

  // Payment state always comes from Stripe, never from the client.
  let allowance;
  try {
    allowance = await claimPersonRun(body.sessionId, body.inputs);
  } catch {
    return jsonError(400, "Could not verify this payment with Stripe.");
  }
  if (!allowance.ok) return jsonError(allowance.status, allowance.reason);
  const { paymentIntentId, runs } = allowance;
  const runsLeft = MAX_REPORT_RUNS - runs;
  const requestId = randomUUID();

  return ndjsonResponse<PersonReportPayload>(async (emit) => {
    const usage = new UsageTracker();
    // Logs counts only: request ID, model, tokens, searches, findings, duration. Never names or inputs.
    const finish = (outcome: "ok" | "error", findings: number) =>
      recordRunUsage(paymentIntentId, usage.log("person_screen", outcome, { requestId, findings })).catch(() => undefined);

    let payload: PersonReportPayload;
    try {
      emit({ type: "status", message: "Payment confirmed. Checking sanctions lists…" });
      const sanctions = screenSanctions(body.inputs);
      const research = await researchPerson(body.inputs, { onEvent: emit, usage });
      emit({ type: "status", message: "Checking every source link…" });
      payload = buildPersonReport(body.inputs, sanctions, research);
    } catch (err) {
      await finish("error", 0);
      const reason = err instanceof PublicError ? err.message : "The screen didn't complete.";
      if (!(err instanceof PublicError)) publicErrorMessage(err);
      const refunded = await refundIfExhausted(paymentIntentId, runs).catch((e: unknown) => {
        console.error("refund failed:", e instanceof Error ? e.constructor.name : typeof e);
        return false;
      });
      emit({
        type: "error",
        final: refunded || runsLeft <= 0,
        message: refunded
          ? `${reason} We couldn't complete your screen after ${MAX_REPORT_RUNS} attempts, so we've refunded your payment in full. Refunds usually appear within 5-10 business days.`
          : runsLeft > 0
            ? `${reason} You can try again (${runsLeft} attempt${runsLeft === 1 ? "" : "s"} left).`
            : `${reason} Please contact support to request a refund.`,
      });
      return;
    }

    await finish("ok", payload.report.findings.length + payload.report.unlikelyMatches.length);
    await recordReportSuccess(paymentIntentId).catch(() => undefined);
    emit({ type: "done", data: payload });
  });
}
