import type { z } from "zod";

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

/** Hosts the dev server may be reached through besides its own address (temporary Cloudflare quick tunnels). */
const TUNNEL_HOST = /^[a-z0-9-]+\.trycloudflare\.com$/;

/**
 * The address the visitor used, for links sent back to them (Stripe return URLs, emailed report links).
 * Behind a tunnel `req.url` says localhost, so the forwarded Host is used instead, but only for tunnel hosts:
 * any other value of that header is client-controlled and is ignored.
 */
export function publicOrigin(req: Request): string {
  const own = new URL(req.url).origin;
  for (const name of ["x-forwarded-host", "host"]) {
    const host = req.headers.get(name)?.split(",")[0]?.trim().toLowerCase();
    if (host && TUNNEL_HOST.test(host)) return `https://${host}`;
  }
  return own;
}

/** Parses a JSON request body against a schema. Returns a 400 Response on failure. */
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S> | Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, "Request body must be JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request.");
  return parsed.data;
}
