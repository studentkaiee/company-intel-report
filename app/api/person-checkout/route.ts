import { z } from "zod";
import { jsonError, parseBody } from "@/lib/http";
import { PublicError } from "@/lib/ndjson";
import { createPersonCheckoutSession } from "@/lib/person/gate";
import { PersonInputSchema } from "@/lib/person/schema";
import { clientIp, verifyTurnstile } from "@/lib/turnstile";

export const runtime = "nodejs";

const BodySchema = z.object({ inputs: PersonInputSchema, turnstileToken: z.string().min(1).max(4096) });

export async function POST(req: Request) {
  const body = await parseBody(req, BodySchema);
  if (body instanceof Response) return body;
  if (!(await verifyTurnstile(body.turnstileToken, clientIp(req)))) {
    return jsonError(403, "The bot check failed. Please try again.");
  }

  const origin = new URL(req.url).origin;
  try {
    const { clientSecret } = await createPersonCheckoutSession(
      body.inputs,
      `${origin}/person-check/report?session_id={CHECKOUT_SESSION_ID}`,
    );
    return Response.json({ clientSecret });
  } catch (err) {
    if (err instanceof PublicError) return jsonError(503, err.message);
    return jsonError(502, "Could not start checkout. Please try again.");
  }
}
