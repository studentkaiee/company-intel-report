import { z } from "zod";
import { lookupUen } from "@/lib/acra";
import { UsageTracker } from "@/lib/cost";
import { env } from "@/lib/env";
import { jsonError, parseBody } from "@/lib/http";
import { ndjsonResponse } from "@/lib/ndjson";
import type { Preview } from "@/lib/report-schema";
import { previewSections, quickScan } from "@/lib/research";
import { issuePreviewToken, readScanTicket } from "@/lib/tokens";

export const runtime = "nodejs";
export const maxDuration = 120;

const BodySchema = z.object({ ticket: z.string().min(1).max(2048) });

export async function POST(req: Request) {
  const body = await parseBody(req, BodySchema);
  if (body instanceof Response) return body;
  const ticket = readScanTicket(body.ticket);
  if (!ticket) return jsonError(403, "This search has expired. Please search again.");

  return ndjsonResponse<Preview>(async (emit) => {
    emit({ type: "status", message: "Checking the registry…" });
    const registry = ticket.uen ? await lookupUen(ticket.uen).catch(() => null) : null;

    emit({ type: "status", message: "Scanning the web…" });
    const usage = new UsageTracker();
    let scan;
    try {
      scan = await quickScan({ companyName: ticket.name, uen: ticket.uen, website: null, registry }, emit, usage);
    } catch (err) {
      usage.log("scan", "error");
      throw err;
    }
    usage.log("scan", "ok");

    emit({
      type: "done",
      data: {
        companyName: registry?.entityName ?? ticket.name,
        uen: ticket.uen,
        website: scan.website,
        registry,
        snapshot: scan.snapshot,
        sections: previewSections(scan.sourceCounts),
        sources: scan.sources,
        previewToken: issuePreviewToken({ name: registry?.entityName ?? ticket.name, uen: ticket.uen, website: scan.website }),
        priceSgdCents: env().REPORT_PRICE_SGD_CENTS,
      },
    });
  });
}
