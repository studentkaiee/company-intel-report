import { z } from "zod";
import { searchAcra } from "@/lib/acra";
import { jsonError, parseBody } from "@/lib/http";
import { issueScanTicket } from "@/lib/tokens";
import { clientIp, verifyTurnstile } from "@/lib/turnstile";

export const runtime = "nodejs";
// The ACRA datastore can be slow; allow for one retry.
export const maxDuration = 40;

const BodySchema = z.object({
  query: z.string().trim().min(2, "Enter at least 2 characters.").max(120),
  mode: z.enum(["acra", "web"]).default("acra"),
  turnstileToken: z.string().min(1, "Please complete the bot check.").max(4096),
});

export async function POST(req: Request) {
  const body = await parseBody(req, BodySchema);
  if (body instanceof Response) return body;

  if (!(await verifyTurnstile(body.turnstileToken, clientIp(req)))) {
    return jsonError(403, "Bot check failed. Please refresh and try again.");
  }

  if (body.mode === "web") {
    return Response.json({
      candidates: [{ name: body.query, uen: null, registry: null, ticket: issueScanTicket({ name: body.query, uen: null }) }],
    });
  }

  try {
    const results = await searchAcra(body.query);
    return Response.json({
      candidates: results.map((r) => ({
        name: r.entityName,
        uen: r.uen,
        registry: r,
        ticket: issueScanTicket({ name: r.entityName, uen: r.uen }),
      })),
      // Turnstile tokens are single-use, so the client keeps this to offer "search the web instead".
      webTicket: issueScanTicket({ name: body.query, uen: null }),
    });
  } catch (err) {
    console.error("ACRA search failed:", err instanceof Error ? `${err.name}: ${err.message}` : typeof err);
    return jsonError(502, "The company registry is not responding. Please try again shortly.");
  }
}
