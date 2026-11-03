import { z } from "zod";
import { PublicError } from "../ndjson";

const PersonEnvSchema = z.object({
  REPORT_HMAC_SECRET: z.string().min(32, "REPORT_HMAC_SECRET must be at least 32 characters"),
  CLAUDE_MODEL: z.string().optional().transform((v) => v || "claude-sonnet-5-5"),
  PERSON_SCREEN_PRICE_SGD_CENTS: z.coerce.number().int().min(50),
});

export type PersonEnv = z.infer<typeof PersonEnvSchema>;

let cached: PersonEnv | undefined;

/**
 * Env vars used only by the Individual Legal Screen. Validated separately so a missing value
 * disables this product without breaking the company report.
 */
export function personEnv(): PersonEnv {
  if (!cached) {
    const parsed = PersonEnvSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error("person screen not configured:", parsed.error.issues.map((i) => i.path.join(".")).join(", "));
      throw new PublicError("This service is not available right now.");
    }
    cached = parsed.data;
  }
  return cached;
}
