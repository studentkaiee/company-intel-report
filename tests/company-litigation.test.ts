import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { companyLitigation, companyOfficialQueries, companyOtherQueries, describeCompany } from "@/lib/company-litigation";
import { renderReportPdf } from "@/lib/pdf/render";
import { SG_MEDIA_DOMAINS, SG_OFFICIAL_SOURCES } from "@/lib/person/outlets";
import { companyTokens, loadEntityLists, screenCompanyList, type SanctionsList } from "@/lib/person/sanctions";
import { NO_INFO_NOTE, ReportSchema, SECTION_KEYS, type RegistryFacts } from "@/lib/report-schema";
import type { Target } from "@/lib/research";

const registry: RegistryFacts = {
  uen: "201912345K",
  entityName: "QUILLBOTTOM MARINE SERVICES PTE. LTD.",
  status: "Live Company",
  entityType: "Local Company",
  registrationDate: "2019-04-01",
  address: "1 ROBINSON ROAD, Singapore 068900",
  issuanceAgency: "ACRA",
  source: "ACRA",
};
const target: Target = { companyName: "Quillbottom Marine", uen: "201912345K", website: null, registry };

describe("company litigation searches", () => {
  it("search the registered name, the name without Pte Ltd, court and insolvency terms, and the UEN", () => {
    const q = companyOfficialQueries(target);
    expect(q).toContain('"QUILLBOTTOM MARINE SERVICES PTE. LTD."');
    expect(q).toContain('"QUILLBOTTOM MARINE SERVICES"');
    expect(q).toContain('"QUILLBOTTOM MARINE SERVICES" "Public Prosecutor"');
    expect(q).toContain('"QUILLBOTTOM MARINE SERVICES PTE. LTD." "judicial management" OR liquidation OR insolvency OR "struck off"');
    expect(q).toContain('"201912345K"');
    expect([...q, ...companyOtherQueries(target)].some((x) => x.includes("site:"))).toBe(false);
  });

  it("describe the company by registry facts, not people", () => {
    const d = describeCompany(target, new Date("2026-11-04"));
    expect(d).toContain("UEN: 201912345K");
    expect(d).toContain("Registered address: 1 ROBINSON ROAD");
  });
});

describe("company sanctions screening", () => {
  const list = (names: string[][]): SanctionsList => ({
    list: "OFAC",
    name: "OFAC",
    source: "t",
    asOf: "2026-10-28",
    entries: names.map((n, i) => ({ id: `E${i}`, names: n, birthYears: [], birthDates: [], nationalities: ["Iran"], program: "IRAN" })),
  });

  it("ignores legal-form words like Pte Ltd and Limited", () => {
    expect(companyTokens("Quillbottom Marine Services Pte. Ltd.")).toEqual(["quillbottom", "marine", "services"]);
    const r = screenCompanyList(["QUILLBOTTOM MARINE SERVICES PTE. LTD."], list([["Quillbottom Marine Services Limited"]]));
    expect(r.matches[0]).toMatchObject({ entryId: "E0", reason: "name similarity 100%; listed address countries: Iran" });
  });

  it("does not match different companies, including ones that share generic words", () => {
    expect(screenCompanyList(["QUILLBOTTOM MARINE SERVICES PTE. LTD."], list([["Oceanic Shipping Co"], ["Marine Services LLC"]])).matches).toEqual([]);
  });

  it("matches a listed name that contains every word of the company's name", () => {
    const r = screenCompanyList(["QUILLBOTTOM MARINE PTE LTD"], list([["Quillbottom Marine and General Trading LLC"]]));
    expect(r.matches).toHaveLength(1);
  });

  it("loads the bundled UN and OFAC entity lists", () => {
    const lists = loadEntityLists();
    expect(lists.map((l) => l.list)).toEqual(["UN", "OFAC", "TSOFA"]);
    expect(lists[1]!.entries.length).toBeGreaterThan(1000);
  });
});

function fakeClient(replies: { official: string; other: string }, urls: { official: string[]; other: string[] }) {
  const sent: { system: string; tools: { allowed_domains?: string[]; blocked_domains?: string[] }[] }[] = [];
  const stream = vi.fn((params: (typeof sent)[number] & { messages: { content: unknown }[] }) => {
    sent.push(params);
    const which = params.system.includes("You search official Singapore") ? "official" : "other";
    const required = String(params.messages[0]?.content ?? "")
      .split("\n")
      .map((l) => l.match(/^\d+\. (.+)$/)?.[1])
      .filter((x): x is string => !!x);
    const content = [
      ...required.map((query, i) => ({ type: "server_tool_use", id: `r${i}`, name: "web_search", input: { query } })),
      { type: "web_search_tool_result", tool_use_id: "r0", content: urls[which].map((url) => ({ type: "web_search_result", url, title: "t" })) },
      { type: "text", text: replies[which] },
    ];
    const msg = { model: "claude-sonnet-5-5", stop_reason: "end_turn", content, usage: { input_tokens: 10, output_tokens: 10 } };
    const handlers: ((b: unknown) => void)[] = [];
    return {
      on(_e: string, cb: (b: unknown) => void) {
        handlers.push(cb);
        return this;
      },
      async finalMessage() {
        for (const b of content) handlers.forEach((h) => h(b));
        return msg;
      },
    };
  });
  return { client: { beta: { messages: { stream } } } as unknown as Anthropic, sent };
}

const judgment = {
  category: "court_judgment",
  case_stage: "civil_claim",
  title: "Quillbottom Marine Services Pte Ltd v Oceanic Pte Ltd [2022] SGHC 10",
  source_name: "eLitigation",
  source_url: "https://www.elitigation.sg/gd/s/2022_SGHC_10",
  additional_source_urls: [],
  date: "2022-01-10",
  summary: "The company sued a supplier for breach of contract; the claim was dismissed.",
  match_confidence: "possible",
  match_evidence: "Same name and UEN in the judgment.",
  historical: false,
};

describe("companyLitigation", () => {
  it("searches Singapore court and regulator sites first, blocks Singapore media elsewhere, and marks court records strong", async () => {
    const { client, sent } = fakeClient(
      {
        official: JSON.stringify({ searches_run: [], findings: [judgment], overall_note: "One civil suit." }),
        other: JSON.stringify({ searches_run: [], findings: [], overall_note: "" }),
      },
      { official: [judgment.source_url], other: [] },
    );
    const lit = await companyLitigation(target, () => {}, undefined, client);

    expect(sent[0]!.tools[0]).toMatchObject({ allowed_domains: SG_OFFICIAL_SOURCES });
    expect(sent[1]!.tools[0]!.blocked_domains).toEqual(expect.arrayContaining(SG_MEDIA_DOMAINS));
    expect(lit.findings).toHaveLength(1);
    expect(lit.findings[0]).toMatchObject({ matchConfidence: "strong", caseStage: "civil_claim" });
    expect(lit.sanctions.lists.map((l) => l.list)).toEqual(["UN", "OFAC", "TSOFA"]);
    expect(lit.searchesRun).toContain('"201912345K"');
  });
});

describe("company report with litigation", () => {
  const sections = Object.fromEntries(SECTION_KEYS.map((k) => [k, { items: [], confidence: "low", note: NO_INFO_NOTE }]));
  const base = { companyName: registry.entityName, uen: registry.uen, website: null, generatedAt: "2026-11-04T08:00:00.000Z", registry, sections, sources: [] };
  const litigation = {
    sanctions: { status: "no_match", lists: [{ list: "UN", name: "UN", asOf: "2026-11-03", checked: true, matches: [] }] },
    findings: [
      {
        category: "court_judgment",
        caseStage: "civil_claim",
        title: judgment.title,
        sourceName: "eLitigation",
        sourceUrl: judgment.source_url,
        additionalSourceUrls: [],
        date: "2010-01-10",
        summary: judgment.summary,
        matchConfidence: "strong",
        matchEvidence: "Same UEN.",
        historical: true,
      },
    ],
    unlikelyMatches: [],
    unlikelyOmitted: 0,
    searchesRun: ['"QUILLBOTTOM MARINE SERVICES PTE. LTD."'],
    overallNote: "One civil suit.",
  };

  it("still accepts reports saved before litigation was added", () => {
    expect(ReportSchema.safeParse(base).success).toBe(true);
  });

  it("renders the litigation section in the PDF", async () => {
    const report = ReportSchema.parse({ ...base, litigation });
    const pdf = await renderReportPdf(report);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
