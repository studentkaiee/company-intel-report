import type { z } from "zod";

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
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
