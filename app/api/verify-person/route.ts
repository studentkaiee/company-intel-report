import { z } from "zod";
import { jsonError, parseBody } from "@/lib/http";
import { publicErrorMessage } from "@/lib/ndjson";
import { safeEqual, verificationCode } from "@/lib/person/canonical";
import { personEnv } from "@/lib/person/env";
import { verificationFields } from "@/lib/person/schema";

export const runtime = "nodejs";

const BodySchema = z.object({
  reportId: z.string().trim().regex(/^ILS-[0-9A-Fa-f]{10}$/, "Enter the report ID as printed, e.g. ILS-1A2B3C4D5E."),
  fullName: z.string().min(2).max(120),
  // Empty when the report has no date of birth.
  dob: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  strong: z.number().int().min(0).max(100),
  possible: z.number().int().min(0).max(100),
  sanctions: z.enum(["no_match", "possible_match"]),
  code: z.string().trim().max(40),
});

/**
 * Stateless check of a PDF's verification code: recomputes it from the details printed on the PDF.
 * Nothing is looked up or stored. Details travel in the POST body, never the URL.
 */
export async function POST(req: Request) {
  const body = await parseBody(req, BodySchema);
  if (body instanceof Response) return body;
  try {
    personEnv();
  } catch (err) {
    return jsonError(503, publicErrorMessage(err));
  }
  const expected = verificationCode(verificationFields(body));
  const given = body.code.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(.{4})(?=.)/g, "$1-");
  return Response.json({ valid: safeEqual(expected, given) }, { headers: { "cache-control": "no-store" } });
}
