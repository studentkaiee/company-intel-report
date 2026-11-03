import { z } from "zod";
import { jsonError, parseBody } from "@/lib/http";
import { publicErrorMessage } from "@/lib/ndjson";
import { renderPersonPdf } from "@/lib/pdf/person-render";
import { personEnv } from "@/lib/person/env";
import { verifyReportSignature } from "@/lib/person/report";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({ report: z.unknown(), signature: z.string().regex(/^[0-9a-f]{64}$/) });

/** Renders the PDF from a report the browser holds. Stateless: the signature proves this server produced it. */
export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > 1_000_000) return jsonError(413, "Report too large.");
  const body = await parseBody(req, BodySchema);
  if (body instanceof Response) return body;
  try {
    personEnv();
  } catch (err) {
    return jsonError(503, publicErrorMessage(err));
  }

  const report = verifyReportSignature(body.report, body.signature);
  if (!report) return jsonError(403, "This report could not be verified.");

  const pdf = await renderPersonPdf(report);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${report.reportId}-individual-legal-screen.pdf"`,
      "cache-control": "no-store",
    },
  });
}
