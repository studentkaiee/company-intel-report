import { z } from "zod";
import { sign, verify } from "./signing";

/** Issued by /api/resolve after Turnstile passes; authorises one quick scan of this target. */
const ScanTicketSchema = z.object({ kind: z.literal("scan"), name: z.string().min(1).max(200), uen: z.string().nullable() });
export type ScanTicket = z.infer<typeof ScanTicketSchema>;

/** Issued by /api/scan; binds the company identity used for checkout metadata. */
const PreviewTokenSchema = z.object({
  kind: z.literal("preview"),
  name: z.string().min(1).max(200),
  uen: z.string().nullable(),
  website: z.string().nullable(),
});
export type PreviewToken = z.infer<typeof PreviewTokenSchema>;

export const issueScanTicket = (t: Omit<ScanTicket, "kind">) => sign({ kind: "scan", ...t }, 30 * 60);
export const issuePreviewToken = (t: Omit<PreviewToken, "kind">) => sign({ kind: "preview", ...t }, 6 * 60 * 60);

export function readScanTicket(token: string): ScanTicket | null {
  const parsed = ScanTicketSchema.safeParse(verify(token));
  return parsed.success ? parsed.data : null;
}

export function readPreviewToken(token: string): PreviewToken | null {
  const parsed = PreviewTokenSchema.safeParse(verify(token));
  return parsed.success ? parsed.data : null;
}

export const CheckoutSessionIdSchema = z.string().regex(/^cs_(test|live)_[A-Za-z0-9]{10,200}$/, "invalid session id");
