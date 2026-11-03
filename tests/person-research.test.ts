import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "@/lib/cost";
import { SG_MEDIA_DOMAINS, SG_OFFICIAL_SOURCES } from "@/lib/person/outlets";
import { describeSubject, researchPerson } from "@/lib/person/research";
import { PersonInputSchema } from "@/lib/person/schema";
import { PERSONAL_VALUES, validInput } from "./fixtures/person";

afterEach(() => vi.restoreAllMocks());

const inputs = PersonInputSchema.parse(validInput);

type Reply = { searchUrls?: string[]; fetchUrls?: string[]; text: string; skipRequired?: boolean };

/** The numbered "Required searches" lines in the prompt. */
const requiredFrom = (params: { messages: { content: unknown }[] }) =>
  String(params.messages[0]?.content ?? "")
    .split("\n")
    .map((l) => l.match(/^\d+\. (.+)$/)?.[1])
    .filter((x): x is string => !!x);

const message = (r: Reply, required: string[]) => ({
  model: "claude-sonnet-5-5",
  stop_reason: "end_turn",
  content: [
    // By default the fake model runs every required search, as instructed.
    ...(r.skipRequired ? [] : required.map((query, i) => ({ type: "server_tool_use", id: `r${i}`, name: "web_search", input: { query } }))),
    ...(r.searchUrls?.length ? [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "live q" } }] : []),
    ...(r.searchUrls?.length
      ? [{ type: "web_search_tool_result", tool_use_id: "s1", content: r.searchUrls.map((url) => ({ type: "web_search_result", url, title: "t" })) }]
      : []),
    ...(r.fetchUrls ?? []).map((url) => ({ type: "web_fetch_tool_result", tool_use_id: "f1", content: { type: "web_fetch_result", url } })),
    { type: "text", text: r.text },
  ],
  usage: { input_tokens: 1000, output_tokens: 200, server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 } },
});

/** "legal" = Singapore court and regulator sites; "media" = the wider web (Singapore news blocked). */
type CallName = "legal" | "media";
const callOf = (system: string): CallName => (system.includes("You search the wider web") ? "media" : "legal");

/** Fake Anthropic client: replies are scripted per call, in order. */
function fakeClient(script: { legal: Reply[]; media: Reply[] }) {
  const sent: unknown[] = [];
  const stream = vi.fn((params: { system: string; messages: { content: unknown }[] }) => {
    sent.push(params);
    const call = callOf(params.system);
    const reply = script[call].shift();
    if (!reply) throw new Error("no scripted reply left");
    const handlers: ((b: unknown) => void)[] = [];
    const msg = message(reply, requiredFrom(params));
    return {
      on(_event: string, cb: (b: unknown) => void) {
        handlers.push(cb);
        return this;
      },
      async finalMessage() {
        for (const b of msg.content) handlers.forEach((h) => h(b));
        return msg;
      },
    };
  });
  return { client: { beta: { messages: { stream } } } as unknown as Anthropic, stream, sent };
}

const finding = (url: string, extra: object = {}) => ({
  category: "local_media",
  case_stage: "charged",
  title: "Charged",
  source_name: "CNA",
  source_url: url,
  additional_source_urls: [],
  date: "2024-01-01",
  summary: "Was charged with cheating.",
  match_confidence: "strong",
  match_evidence: "Same company.",
  historical: false,
  ...extra,
});

const json = (findings: object[], searches: string[] = ["q"]) => JSON.stringify({ searches_run: searches, findings, overall_note: "" });

describe("researchPerson", () => {
  it("sends only name, aliases, year of birth, nationality and context to the model", () => {
    const prompt = describeSubject(inputs, new Date("2026-11-03"));
    expect(prompt).toContain("Year of birth: 1980");
    expect(prompt).not.toContain("1980-05-17");
    expect(prompt).not.toContain("director_onboarding");
  });

  it("runs both calls with Singapore-located web search and web fetch, and merges findings", async () => {
    const { client, sent } = fakeClient({
      legal: [{ searchUrls: ["https://www.elitigation.sg/gd/s/2024_SGHC_1"], text: json([finding("https://www.elitigation.sg/gd/s/2024_SGHC_1", { category: "court_judgment" })], ["legal q"]) }],
      media: [{ searchUrls: ["https://www.straitstimes.com/a"], fetchUrls: ["https://www.zaobao.com.sg/b"], text: json([finding("https://www.straitstimes.com/a", { additional_source_urls: ["https://www.zaobao.com.sg/b"] })], ["media q"]) }],
    });
    const r = await researchPerson(inputs, { onEvent: () => {}, client });

    expect(r.findings.map((f) => f.category).sort()).toEqual(["court_judgment", "local_media"]);
    expect(r.findings.find((f) => f.category === "local_media")!.additionalSourceUrls).toEqual(["https://www.zaobao.com.sg/b"]);
    // Queries that actually ran are listed even when the model leaves them out of searches_run.
    expect(r.searchesRun).toEqual(expect.arrayContaining(["legal q", "live q", "media q", '"Tan Wei Ming" "Public Prosecutor"']));
    expect(r.searchesRun.some((q) => q.includes("site:"))).toBe(false);

    const tools = (sent[0] as { tools: { type: string; user_location?: unknown; max_uses?: number; allowed_callers?: string[] }[] }).tools;
    expect(tools.map((t) => t.type)).toEqual(["web_search_20260209", "web_fetch_20260209"]);
    expect(tools.map((t) => t.allowed_callers)).toEqual([["direct"], ["direct"]]);
    expect(tools[0]).toMatchObject({ max_uses: 15, user_location: { city: "Singapore", timezone: "Asia/Singapore" } });
    expect(tools[0]!.user_location).not.toHaveProperty("country");
  });

  it("sends the model back once when it skips required searches", async () => {
    const { client, stream, sent } = fakeClient({
      legal: [{ text: json([]) }],
      media: [{ text: json([]), skipRequired: true }, { text: json([]) }],
    });
    await researchPerson(inputs, { onEvent: () => {}, client });
    expect(stream).toHaveBeenCalledTimes(3);
    const followUp = JSON.stringify(sent.find((p) => JSON.stringify(p).includes("You have not yet run these required searches")));
    expect(followUp).toContain("regulator OR enforcement OR disqualified");
  });

  it("searches Singapore court and regulator sites first, and blocks Singapore news media elsewhere", async () => {
    const { client, sent } = fakeClient({ legal: [{ text: json([]) }], media: [{ text: json([]) }] });
    await researchPerson(inputs, { onEvent: () => {}, client });
    type Sent = { system: string; output_config: { effort: string }; tools: { allowed_domains?: string[]; blocked_domains?: string[] }[] };
    const byCall = Object.fromEntries((sent as Sent[]).map((p) => [callOf(p.system), p]));
    expect(byCall.legal!.output_config.effort).toBe("high");
    expect(byCall.media!.output_config.effort).toBe("medium");
    expect(byCall.legal!.tools[0]).toMatchObject({ allowed_domains: SG_OFFICIAL_SOURCES });
    expect(byCall.legal!.tools[0]).not.toHaveProperty("blocked_domains");
    expect(byCall.media!.tools[0]!.blocked_domains).toEqual(expect.arrayContaining(SG_MEDIA_DOMAINS));
    expect(byCall.media!.tools[0]).not.toHaveProperty("allowed_domains");
    // The first call started is the Singapore official-sources one.
    expect(callOf((sent[0] as Sent).system)).toBe("legal");
  });

  it("makes any finding from judiciary.gov.sg or eLitigation a strong match", async () => {
    const { client } = fakeClient({
      legal: [
        {
          searchUrls: ["https://www.judiciary.gov.sg/hearing-list/x", "https://www.elitigation.sg/gd/s/2015_SGHC_31", "https://www.mas.gov.sg/a"],
          text: json([
            finding("https://www.judiciary.gov.sg/hearing-list/x", { category: "court_judgment", match_confidence: "weak" }),
            finding("https://www.elitigation.sg/gd/s/2015_SGHC_31", { category: "court_judgment", match_confidence: "possible" }),
            finding("https://www.mas.gov.sg/a", { category: "regulatory_action", match_confidence: "possible" }),
          ]),
        },
      ],
      media: [{ text: json([]) }],
    });
    const r = await researchPerson(inputs, { onEvent: () => {}, client });
    const by = (host: string) => r.findings.find((f) => f.sourceUrl.includes(host))!;
    expect(by("judiciary.gov.sg").matchConfidence).toBe("strong");
    expect(by("judiciary.gov.sg").matchEvidence).toMatch(/official Singapore court record/);
    expect(by("elitigation.sg").matchConfidence).toBe("strong");
    expect(by("mas.gov.sg").matchConfidence).toBe("possible");
  });

  it("works with only a name", async () => {
    const { client, sent } = fakeClient({ legal: [{ text: json([]) }], media: [{ text: json([]) }] });
    const nameOnly = PersonInputSchema.parse({ fullName: "Tan Wei Ming", consent: true });
    await researchPerson(nameOnly, { onEvent: () => {}, client });
    const prompt = String((sent[0] as { messages: { content: string }[] }).messages[0]!.content);
    expect(prompt).not.toContain("Year of birth");
    expect(prompt).toContain("Only the name was given");
  });

  it("drops a finding whose URL was not in the search results", async () => {
    const { client } = fakeClient({
      legal: [{ searchUrls: ["https://real.example/a"], text: json([finding("https://real.example/a"), finding("https://hallucinated.example/b")]) }],
      media: [{ text: json([]) }],
    });
    const r = await researchPerson(inputs, { onEvent: () => {}, client });
    expect(r.findings.map((f) => f.sourceUrl)).toEqual(["https://real.example/a"]);
  });

  it("asks once to fix invalid JSON, without searching again", async () => {
    const { client, stream, sent } = fakeClient({
      legal: [{ searchUrls: ["https://real.example/a"], text: "I found one thing: {not json" }, { text: json([finding("https://real.example/a")]) }],
      media: [{ text: json([]) }],
    });
    const r = await researchPerson(inputs, { onEvent: () => {}, client });
    expect(r.findings).toHaveLength(1);
    expect(stream).toHaveBeenCalledTimes(3);
    const repair = sent.find((p) => JSON.stringify(p).includes("did not pass validation"));
    expect(repair).toBeDefined();
  });

  it("retries a call once from scratch, then fails the whole screen", async () => {
    const bad = { text: "no json here" };
    const { client, stream } = fakeClient({ legal: [bad, bad, bad, bad], media: [{ text: json([]) }, { text: json([]) }] });
    await expect(researchPerson(inputs, { onEvent: () => {}, client })).rejects.toThrow(/could not be validated|didn't complete/);
    // legal: attempt + repair, retry + repair = 4; media: 1.
    expect(stream).toHaveBeenCalledTimes(5);
  });

  it("logs usage with counts only, never personal details", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({
      legal: [{ searchUrls: ["https://real.example/a"], text: json([finding("https://real.example/a")], ["Tan Wei Ming court"]) }],
      media: [{ text: json([]) }],
    });
    const usage = new UsageTracker();
    const r = await researchPerson(inputs, { onEvent: () => {}, client, usage });
    usage.log("person_screen", "ok", { requestId: "req-1", findings: r.findings.length });

    const logged = JSON.stringify([...info.mock.calls, ...error.mock.calls]);
    for (const v of PERSONAL_VALUES) expect(logged).not.toContain(v);
    const line = JSON.parse(String(info.mock.calls[0]![0]));
    expect(line).toMatchObject({ event: "research_usage", kind: "person_screen", requestId: "req-1", findings: 1, webSearches: 4, models: ["claude-sonnet-5-5"] });
  });
});
