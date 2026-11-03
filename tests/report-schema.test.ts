import { describe, expect, it } from "vitest";
import { extractJson, parseJson } from "@/lib/agent";
import {
  ModelReportSchema,
  NO_INFO_NOTE,
  SECTION_KEYS,
  SectionSchema,
  groundSections,
  normalizeUrl,
  type Section,
  type Source,
} from "@/lib/report-schema";

const src = (id: string, url: string): Source => ({ id, title: `Title ${id}`, url, retrievedAt: "2026-11-03" });
const empty = { items: [], confidence: "low" as const };

function modelReport(overrides: Record<string, unknown> = {}) {
  return {
    ...Object.fromEntries(SECTION_KEYS.map((k) => [k, empty])),
    snapshot: { items: [{ text: "Makes widgets.", sourceIds: ["S1"] }], confidence: "high" },
    sources: [src("S1", "https://acme.sg/about")],
    ...overrides,
  };
}

describe("SectionSchema", () => {
  it("adds the 'no public information' note to empty sections", () => {
    expect(SectionSchema.parse(empty).note).toBe(NO_INFO_NOTE);
  });

  it("rejects items without a citation", () => {
    expect(SectionSchema.safeParse({ items: [{ text: "x", sourceIds: [] }], confidence: "low" }).success).toBe(false);
  });

  it("rejects malformed source ids", () => {
    expect(SectionSchema.safeParse({ items: [{ text: "x", sourceIds: ["source-1"] }], confidence: "low" }).success).toBe(false);
  });
});

describe("ModelReportSchema", () => {
  it("accepts a valid report", () => {
    expect(ModelReportSchema.safeParse(modelReport()).success).toBe(true);
  });

  it("rejects citations to unknown sources", () => {
    const r = modelReport({ riskFlags: { items: [{ text: "Struck off.", sourceIds: ["S9"] }], confidence: "low" } });
    const parsed = ModelReportSchema.safeParse(r);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toContain("S9");
  });

  it("rejects a missing section", () => {
    const r = modelReport();
    delete (r as Record<string, unknown>).marketingStrategy;
    expect(ModelReportSchema.safeParse(r).success).toBe(false);
  });

  it("rejects non-http source urls", () => {
    expect(ModelReportSchema.safeParse(modelReport({ sources: [src("S1", "javascript:alert(1)")] })).success).toBe(false);
  });
});

describe("groundSections", () => {
  it("drops sources the agent never saw and items left uncited", () => {
    const sections: Partial<Record<string, Section>> = {
      snapshot: {
        items: [
          { text: "Real", sourceIds: ["S1"] },
          { text: "Invented", sourceIds: ["S2"] },
          { text: "Mixed", sourceIds: ["S1", "S2"] },
        ],
        confidence: "high",
      },
      riskFlags: { items: [{ text: "Only invented", sourceIds: ["S2"] }], confidence: "medium" },
    };
    const sources = [src("S1", "https://www.acme.sg/about/"), src("S2", "https://made-up.example/x")];
    const out = groundSections(sections, sources, new Set([normalizeUrl("https://acme.sg/about")]));

    expect(out.sources.map((s) => s.id)).toEqual(["S1"]);
    expect(out.sections.snapshot?.items.map((i) => i.text)).toEqual(["Real", "Mixed"]);
    expect(out.sections.snapshot?.items[1]?.sourceIds).toEqual(["S1"]);
    expect(out.sections.riskFlags).toEqual({ items: [], confidence: "low", note: NO_INFO_NOTE });
  });
});

describe("model JSON extraction", () => {
  it("parses JSON wrapped in prose or code fences", () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Result: {"a":{"b":2}} done')).toEqual({ a: { b: 2 } });
  });

  it("reports validation errors with paths", () => {
    const r = parseJson(ModelReportSchema, JSON.stringify(modelReport({ sources: "nope" })));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("sources");
  });

  it("fails cleanly on text with no JSON", () => {
    expect(parseJson(ModelReportSchema, "I could not find anything.").ok).toBe(false);
  });
});
