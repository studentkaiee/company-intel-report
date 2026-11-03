import { z } from "zod";
import { env } from "./env";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const ResultSchema = z.object({ success: z.boolean() });

export async function verifyTurnstile(token: string, remoteIp: string | null, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!token) return false;
  const body = new URLSearchParams({ secret: env().TURNSTILE_SECRET_KEY, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  try {
    const res = await fetchImpl(VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return false;
    const parsed = ResultSchema.safeParse(await res.json());
    return parsed.success && parsed.data.success;
  } catch {
    return false;
  }
}

export function clientIp(req: Request): string | null {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}
