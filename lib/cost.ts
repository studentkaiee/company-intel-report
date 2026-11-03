/**
 * Usage tracking and cost estimates for research runs. Counts only: never company names or content.
 * Prices are Anthropic list prices in US$ per million tokens (checked Nov 2026); update them if pricing changes.
 */

type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const MODEL_PRICES: Record<string, Price> = {
  // Haiku 5.5 list price for prompts up to 100K tokens; quick scans stay well under that.
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  // Possible refusal-fallback model on the deep research call.
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

/** Web search is billed per search; web fetch has no per-request fee (only the tokens it adds). */
export const WEB_SEARCH_USD = 10 / 1000;

/** The subset of the API's `usage` object we read. */
export type ApiUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests: number; web_fetch_requests: number } | null;
};

export type UsageTotals = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
  webFetches: number;
  /** null if any request used a model missing from MODEL_PRICES. */
  costUsd: number | null;
  models: string[];
};

export function costOf(model: string, u: ApiUsage): number | null {
  const p = MODEL_PRICES[model];
  if (!p) return null;
  const tokens =
    u.input_tokens * p.input +
    u.output_tokens * p.output +
    (u.cache_read_input_tokens ?? 0) * p.cacheRead +
    (u.cache_creation_input_tokens ?? 0) * p.cacheWrite;
  return tokens / 1_000_000 + (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD;
}

/** Accumulates usage across every API request in one run, including runs that later fail. */
export class UsageTracker {
  private t: UsageTotals = {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    webSearches: 0,
    webFetches: 0,
    costUsd: 0,
    models: [],
  };
  private readonly started = Date.now();

  add(model: string, u: ApiUsage): void {
    const t = this.t;
    t.requests++;
    t.inputTokens += u.input_tokens;
    t.outputTokens += u.output_tokens;
    t.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    t.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
    t.webSearches += u.server_tool_use?.web_search_requests ?? 0;
    t.webFetches += u.server_tool_use?.web_fetch_requests ?? 0;
    const c = costOf(model, u);
    t.costUsd = t.costUsd === null || c === null ? null : t.costUsd + c;
    if (!t.models.includes(model)) t.models.push(model);
  }

  totals(): UsageTotals {
    return { ...this.t, models: [...this.t.models] };
  }

  /**
   * One structured log line per run, for Vercel log search. `extra` is for counts and IDs only
   * (e.g. a request ID or number of findings), never names, inputs or report content.
   */
  log(kind: "scan" | "report" | "person_screen", outcome: "ok" | "error", extra: Record<string, string | number> = {}): UsageTotals {
    const totals = this.totals();
    console.info(
      JSON.stringify({
        event: "research_usage",
        kind,
        outcome,
        ...extra,
        durationMs: Date.now() - this.started,
        ...totals,
        costUsd: totals.costUsd === null ? null : Number(totals.costUsd.toFixed(4)),
      }),
    );
    return totals;
  }
}
