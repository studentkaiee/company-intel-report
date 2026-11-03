import { z } from "zod";
import { lookupUen } from "@/lib/acra";
import { UsageTracker } from "@/lib/cost";
import { maskEmail, sendReportEmail } from "@/lib/email";
import { jsonError, parseBody } from "@/lib/http";
import { PublicError, ndjsonResponse, publicErrorMessage } from "@/lib/ndjson";
import { reportFilename } from "@/lib/pdf/filename";
import { renderReportPdf } from "@/lib/pdf/render";
import type { ReportPayload } from "@/lib/report-schema";
import { deepResearch } from "@/lib/research";
import { signDetached } from "@/lib/signing";
import { MAX_REPORT_RUNS, claimReportRun, recordReportSuccess, recordRunUsage, refundIfExhausted } from "@/lib/stripe";
import { CheckoutSessionIdSchema } from "@/lib/tokens";

export const runtime = "nodejs";
// Vercel Hobby (fluid compute) allows up to 300s; on Pro raise this to 800.
export const maxDuration = 300;

const BodySchema = z.object({ sessionId: CheckoutSessionIdSchema });

export async function POST(req: Request) {
  const body = await parseBody(req, BodySchema);
  if (body instanceof Response) return body;

  // Payment state always comes from Stripe, never from the client.
  let allowance;
  try {
    allowance = await claimReportRun(body.sessionId);
  } catch {
    return jsonError(400, "Could not verify this payment with Stripe.");
  }
  if (!allowance.ok) return jsonError(allowance.status, allowance.reason);
  const { meta, runs, paymentIntentId, email } = allowance;
  const runsLeft = MAX_REPORT_RUNS - runs;
  const reportUrl = `${new URL(req.url).origin}/report?session_id=${encodeURIComponent(body.sessionId)}`;

  return ndjsonResponse<ReportPayload>(async (emit) => {
    const usage = new UsageTracker();
    const saveUsage = (outcome: "ok" | "error") =>
      recordRunUsage(paymentIntentId, usage.log("report", outcome)).catch(() => undefined);
    let report;
    try {
      emit({ type: "status", message: "Payment confirmed. Reading the registry…" });
      const registry = meta.uen ? await lookupUen(meta.uen).catch(() => null) : null;

      emit({ type: "status", message: "Researching (this usually takes 2-4 minutes)…" });
      report = await deepResearch(
        { companyName: meta.company_name, uen: meta.uen || null, website: meta.website || null, registry },
        emit,
        usage,
      );
    } catch (err) {
      await saveUsage("error");
      // publicErrorMessage logs the error class; its generic text is replaced with a clearer one here.
      const reason = err instanceof PublicError ? err.message : "The research didn't complete.";
      if (!(err instanceof PublicError)) publicErrorMessage(err);
      const refunded = await refundIfExhausted(paymentIntentId, runs).catch((e: unknown) => {
        console.error("refund failed:", e instanceof Error ? e.constructor.name : typeof e);
        return false;
      });
      if (refunded) {
        emit({
          type: "error",
          final: true,
          message: `${reason} We couldn't complete your report after ${MAX_REPORT_RUNS} attempts, so we've refunded your payment in full. Refunds usually appear within 5-10 business days.`,
        });
      } else {
        emit({
          type: "error",
          final: runsLeft <= 0,
          message:
            runsLeft > 0
              ? `${reason} You can try again (${runsLeft} attempt${runsLeft === 1 ? "" : "s"} left).`
              : `${reason} Please contact support.`,
        });
      }
      return;
    }

    await saveUsage("ok");
    await recordReportSuccess(paymentIntentId).catch(() => undefined);
    const reportJson = JSON.stringify(report);

    let emailedTo: string | null = null;
    if (email) {
      emit({ type: "status", message: "Emailing you a copy of the PDF…" });
      try {
        const sent = await sendReportEmail(
          {
            to: email,
            companyName: report.companyName,
            pdf: await renderReportPdf(report),
            filename: reportFilename(report.companyName),
            reportUrl,
          },
          `report-email-${paymentIntentId}-${runs}`,
        );
        if (sent) emailedTo = maskEmail(email);
      } catch {
        // PDF render failed; the buyer can still download it from the page.
      }
    }

    emit({
      type: "done",
      data: { reportJson, signature: signDetached(`${body.sessionId}\n${reportJson}`), runsLeft, emailedTo },
    });
  });
}
