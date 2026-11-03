import { z } from "zod";
import { jsonError, parseBody } from "@/lib/http";
import { createCheckoutSession } from "@/lib/stripe";
import { readPreviewToken } from "@/lib/tokens";

export const runtime = "nodejs";

const BodySchema = z.object({ previewToken: z.string().min(1).max(2048) });

export async function POST(req: Request) {
  const body = await parseBody(req, BodySchema);
  if (body instanceof Response) return body;
  const preview = readPreviewToken(body.previewToken);
  if (!preview) return jsonError(403, "This preview has expired. Please run the search again.");

  const origin = new URL(req.url).origin;
  try {
    const { clientSecret } = await createCheckoutSession(
      { uen: preview.uen ?? "", company_name: preview.name, website: preview.website ?? "" },
      `${origin}/report?session_id={CHECKOUT_SESSION_ID}`,
    );
    return Response.json({ clientSecret });
  } catch {
    return jsonError(502, "Could not start checkout. Please try again.");
  }
}
