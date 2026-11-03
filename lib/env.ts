import { z } from "zod";

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  REPORT_PRICE_SGD_CENTS: z.coerce.number().int().min(50),
  REPORT_SIGNING_SECRET: z.string().min(32, "REPORT_SIGNING_SECRET must be at least 32 characters"),
  // Optional: when either is missing, reports are not emailed.
  RESEND_API_KEY: z.string().optional().transform((v) => v || undefined),
  RESEND_FROM_EMAIL: z.string().optional().transform((v) => v || undefined),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** Server-only env vars, validated on first use. */
export function env(): Env {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Missing or invalid environment variables: ${missing}`);
    }
    cached = parsed.data;
  }
  return cached;
}
