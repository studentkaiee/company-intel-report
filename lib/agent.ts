import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { UsageTracker } from "./cost";
import { env } from "./env";
import { normalizeUrl } from "./report-schema";
import { PublicError, type ProgressEvent } from "./ndjson";

let client: Anthropic | undefined;
function anthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, maxRetries: 2 });
  return client;
}

type Tool = Anthropic.Beta.BetaToolUnion;
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type AgentOptions<S extends z.ZodType> = {
  model: string;
  system: string;
  prompt: string;
  tools: Tool[];
  maxTokens: number;
  effort: Effort;
  schema: S;
  /** Server-side refusal fallback (supported on Sonnet 5.5 / Opus 5.5, not on Haiku). */
  serverFallback?: boolean;
  /** How many times to resume a `pause_turn` (long server-tool turns). */
  maxContinuations?: number;
  onEvent?: (e: ProgressEvent<never>) => void;
  /** Receives token and search counts for every request, even if the run later fails. */
  usage?: UsageTracker;
  /** Override the API client (tests pass a fake). */
  client?: Anthropic;
  /**
   * Called once with the web searches run so far, before the answer is accepted. Return a message to send the model
   * back to work (e.g. "you skipped these required searches"), or null to accept the answer.
   */
  checkSearches?: (queriesRun: string[]) => string | null;
};

export type AgentResult<T> = { data: T; seenUrls: Set<string> };

/**
 * Runs one research conversation with Anthropic server tools (web search / fetch),
 * resumes paused turns, then parses and validates the final JSON against `schema`.
 * If validation fails it asks the model once to fix its JSON.
 */
export async function runResearchAgent<S extends z.ZodType>(opts: AgentOptions<S>): Promise<AgentResult<z.output<S>>> {
  const seenUrls = new Set<string>();
  const queriesRun: string[] = [];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.prompt }];
  const maxContinuations = opts.maxContinuations ?? 4;

  const runTurn = async (): Promise<Anthropic.Beta.BetaMessage> => {
    let continuations = 0;
    for (;;) {
      const stream = (opts.client ?? anthropic()).beta.messages.stream({
        model: opts.model,
        max_tokens: opts.maxTokens,
        system: opts.system,
        tools: opts.tools,
        messages,
        output_config: { effort: opts.effort },
        ...(opts.serverFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      stream.on("contentBlock", (block) => {
        if (block.type === "server_tool_use" && block.name === "web_search") {
          const query = (block.input as { query?: unknown } | null)?.query;
          if (typeof query === "string") queriesRun.push(query);
        }
        handleBlock(block, seenUrls, opts.onEvent);
      });
      const message = await stream.finalMessage();
      opts.usage?.add(message.model, message.usage);

      if (message.stop_reason === "refusal") {
        throw new PublicError("The research model declined this request.");
      }
      if (message.stop_reason === "pause_turn" && continuations < maxContinuations) {
        continuations++;
        messages.push({ role: "assistant", content: message.content });
        continue;
      }
      return message;
    }
  };

  let message = await runTurn();
  const sendBack = opts.checkSearches?.(queriesRun);
  if (sendBack) {
    opts.onEvent?.({ type: "status", message: "Running the remaining required searches…" });
    messages.push({ role: "assistant", content: message.content });
    messages.push({ role: "user", content: sendBack });
    message = await runTurn();
  }
  let result = parseJson(opts.schema, finalText(message));
  if (!result.ok) {
    console.error("model output failed validation:", issuePaths(opts.schema, finalText(message)));
    opts.onEvent?.({ type: "status", message: "Tidying up the findings…" });
    messages.push({ role: "assistant", content: message.content });
    messages.push({
      role: "user",
      content:
        `Your answer did not pass validation: ${result.error}\n` +
        "Do not search again. Reply with the corrected JSON object only, no prose, no code fences.",
    });
    message = await runTurn();
    result = parseJson(opts.schema, finalText(message));
  }
  if (!result.ok) {
    console.error("model output failed validation after repair:", issuePaths(opts.schema, finalText(message)));
    throw new PublicError("The research results could not be validated. Please try again.");
  }
  return { data: result.data, seenUrls };
}

function handleBlock(
  block: Anthropic.Beta.BetaContentBlock,
  seenUrls: Set<string>,
  onEvent?: (e: ProgressEvent<never>) => void,
) {
  if (block.type === "server_tool_use") {
    const input = (block.input ?? {}) as { query?: unknown; url?: unknown };
    if (block.name === "web_search" && typeof input.query === "string") onEvent?.({ type: "search", query: input.query });
    if (block.name === "web_fetch" && typeof input.url === "string") onEvent?.({ type: "fetch", url: input.url });
  } else if (block.type === "web_search_tool_result") {
    // Success content is a list; an error is a single object.
    if (Array.isArray(block.content)) for (const r of block.content) seenUrls.add(normalizeUrl(r.url));
  } else if (block.type === "web_fetch_tool_result") {
    if (block.content.type === "web_fetch_result") seenUrls.add(normalizeUrl(block.content.url));
  }
}

function finalText(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Where validation failed, as field paths and issue codes only: never the model's text, which can hold report content. */
function issuePaths(schema: z.ZodType, text: string): string {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch {
    return "no JSON object found";
  }
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? "ok"
    : parsed.error.issues
        .slice(0, 10)
        .map((i) => `${i.path.join(".") || "(root)"} [${i.code}]`)
        .join("; ");
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object found");
  return JSON.parse(candidate.slice(start, end + 1));
}

export function parseJson<S extends z.ZodType>(
  schema: S,
  text: string,
): { ok: true; data: z.output<S> } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "invalid JSON" };
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues = parsed.error.issues
    .slice(0, 15)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, error: issues };
}
