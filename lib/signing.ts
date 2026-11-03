import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Small HMAC-signed tokens so state can travel through the browser without a database.
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
 */

function hmac(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function sign<T extends object>(payload: T, ttlSeconds: number, secret = env().REPORT_SIGNING_SECRET): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString(
    "base64url",
  );
  return `${body}.${hmac(body, secret)}`;
}

export function verify<T>(token: string, secret = env().REPORT_SIGNING_SECRET): (T & { exp: number }) | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(hmac(body, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Detached signature over an arbitrary string (used to bind a finished report to its checkout session). */
export function signDetached(data: string, secret = env().REPORT_SIGNING_SECRET): string {
  return hmac(data, secret);
}

export function verifyDetached(data: string, mac: string, secret = env().REPORT_SIGNING_SECRET): boolean {
  const expected = Buffer.from(hmac(data, secret));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
