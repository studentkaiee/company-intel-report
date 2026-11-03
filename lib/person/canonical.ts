import { createHmac, timingSafeEqual } from "node:crypto";
import { personEnv } from "./env";

/** JSON with object keys sorted at every level and undefined values dropped, so equal data always hashes equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

// Each use gets its own prefix so a value signed for one purpose can't be replayed as another.
type Purpose = "input" | "report" | "verify";

export function hmacHex(purpose: Purpose, value: unknown, secret = personEnv().REPORT_HMAC_SECRET): string {
  return createHmac("sha256", secret).update(`${purpose}\n${canonicalJson(value)}`).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const BASE32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I, easy to read off a PDF

/** Short, typeable code (5 groups of 4, 100 bits) derived from the HMAC of `value`. */
export function verificationCode(value: unknown, secret?: string): string {
  const bytes = Buffer.from(hmacHex("verify", value, secret), "hex");
  let bits = 0;
  let acc = 0;
  let out = "";
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5 && out.length < 20) {
      out += BASE32[(acc >> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  return out.match(/.{4}/g)!.join("-");
}
