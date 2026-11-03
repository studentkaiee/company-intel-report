import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageTracker, WEB_SEARCH_USD, costOf } from "@/lib/cost";
import { usageMetadata } from "@/lib/stripe";

afterEach(() => vi.restoreAllMocks());

const usage = (over: Partial<Parameters<typeof costOf>[1]> = {}) => ({
  input_tokens: 1_000_000,
  output_tokens: 100_000,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
  ...over,
});

describe("costOf", () => {
  it("prices tokens and searches per model", () => {
    // Sonnet 5.5: 1M in x $2 + 0.1M out x $10 = $3, plus 25 searches x $0.01.
    expect(costOf("claude-sonnet-5-5", usage({ server_tool_use: { web_search_requests: 25, web_fetch_requests: 3 } }))).toBeCloseTo(
      3 + 25 * WEB_SEARCH_USD,
    );
    // Haiku 5.5: $0.10 + $0.05.
    expect(costOf("claude-haiku-5-5", usage())).toBeCloseTo(0.15);
  });

  it("includes cache reads and writes", () => {
    const u = usage({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 });
    expect(costOf("claude-sonnet-5-5", u)).toBeCloseTo(0.2 + 2.5);
  });

  it("returns null for unknown models", () => {
    expect(costOf("claude-unknown", usage())).toBeNull();
  });
});

describe("UsageTracker", () => {
  it("sums several requests and logs counts only", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const t = new UsageTracker();
    t.add("claude-sonnet-5-5", usage({ input_tokens: 1000, output_tokens: 200, server_tool_use: { web_search_requests: 3, web_fetch_requests: 1 } }));
    t.add("claude-sonnet-5-5", usage({ input_tokens: 500, output_tokens: 100, server_tool_use: null }));
    const totals = t.log("report", "ok");

    expect(totals).toMatchObject({ requests: 2, inputTokens: 1500, outputTokens: 300, webSearches: 3, webFetches: 1, models: ["claude-sonnet-5-5"] });
    expect(totals.costUsd).toBeCloseTo((1500 * 2 + 300 * 10) / 1e6 + 3 * WEB_SEARCH_USD);

    const line = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(line).toMatchObject({ event: "research_usage", kind: "report", outcome: "ok", webSearches: 3 });
    expect(Object.keys(line).sort()).toEqual(
      ["cacheReadTokens", "cacheWriteTokens", "costUsd", "durationMs", "event", "inputTokens", "kind", "models", "outcome", "outputTokens", "requests", "webFetches", "webSearches"].sort(),
    );
  });

  it("marks cost unknown once an unpriced model appears", () => {
    const t = new UsageTracker();
    t.add("claude-sonnet-5-5", usage());
    t.add("claude-unknown", usage());
    expect(t.totals().costUsd).toBeNull();
  });
});

describe("usageMetadata", () => {
  const run = { requests: 4, inputTokens: 1200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 20, webFetches: 5, costUsd: 0.75, models: ["claude-sonnet-5-5"] };

  it("adds this run to the purchase totals", () => {
    expect(usageMetadata({ cost_usd_total: "0.5000", web_searches_total: "10" }, run)).toEqual({
      cost_usd_last_run: "0.7500",
      cost_usd_total: "1.2500",
      web_searches_total: "30",
      tokens_last_run: "1200 in / 300 out",
    });
  });

  it("starts from zero and handles unknown cost", () => {
    expect(usageMetadata({}, run).cost_usd_total).toBe("0.7500");
    expect(usageMetadata({}, { ...run, costUsd: null })).toMatchObject({ cost_usd_last_run: "unknown", cost_usd_total: "unknown" });
  });
});
