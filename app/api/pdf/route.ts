import { z } from "zod";
import { jsonError, parseBody } from "@/lib/http";
import { reportFilename } from "@/lib/pdf/filename";
import { renderReportPdf } from "@/lib/pdf/render";
import { ReportSchema } from "@/lib/report-schema";
import { verifyDetached } from "@/lib/signing";
import { isPaid } from "@/lib/stripe";
import { CheckoutSessionIdSchema } from "@/lib/tokens";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  sessionId: CheckoutSessionIdSchema,
  reportJson: z.string().min(2).max(1_000_000),
  signature: z.string().min(10).max(200),
});

export async function POST(req: Request) {
  const body = await parseBody(req, BodySchema);
  if (body instanceof Response) return body;

  // The report must be one this server produced for this paid session.
  if (!verifyDetached(`${body.sessionId}\n${body.reportJson}`, body.signature)) {
    return jsonError(403, "This report could not be verified.");
  }
  try {
    if (!(await isPaid(body.sessionId))) return jsonError(402, "Payment has not been completed.");
  } catch {
    return jsonError(400, "Could not verify this payment with Stripe.");
  }

  const report = ReportSchema.parse(JSON.parse(body.reportJson));
  const pdf = await renderReportPdf(report);
  const filename = reportFilename(report.companyName);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
