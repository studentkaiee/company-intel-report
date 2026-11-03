/** Newline-delimited JSON progress streams shared by /api/scan and /api/report. */

export type ProgressEvent<T> =
  | { type: "status"; message: string }
  | { type: "search"; query: string }
  | { type: "fetch"; url: string }
  | { type: "done"; data: T }
  /** `final` means retrying cannot help (e.g. the purchase was refunded). */
  | { type: "error"; message: string; final?: boolean };

export function ndjsonResponse<T>(run: (emit: (e: ProgressEvent<T>) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: ProgressEvent<T>) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await run(emit);
      } catch (err) {
        emit({ type: "error", message: publicErrorMessage(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Errors we raise on purpose carry a user-facing message; everything else is generic. */
export class PublicError extends Error {}

export function publicErrorMessage(err: unknown): string {
  if (err instanceof PublicError) return err.message;
  // Log the class only: never request bodies or report content.
  const status = (err as { status?: unknown } | null)?.status;
  console.error("request failed:", err instanceof Error ? err.constructor.name : typeof err, status ?? "");
  return "Something went wrong. Please try again.";
}

export async function readNdjson<T>(res: Response, onEvent: (e: ProgressEvent<T>) => void): Promise<void> {
  if (!res.body) throw new Error("No response body");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as ProgressEvent<T>);
    }
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as ProgressEvent<T>);
}
