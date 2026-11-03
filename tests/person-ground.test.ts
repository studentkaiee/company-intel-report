import { describe, expect, it } from "vitest";
import { parseJson } from "@/lib/agent";
import { groundFindings, mergeFindings, splitByConfidence } from "@/lib/person/ground";
import { ModelScreenSchema, type Finding, type ModelScreen } from "@/lib/person/schema";

const modelFinding = (over: Partial<ModelScreen["findings"][number]> = {}): ModelScreen["findings"][number] => ({
  category: "local_media",
  case_stage: "charged",
  title: "Director charged with cheating",
  source_name: "CNA",
  source_url: "https://www.channelnewsasia.com/singapore/director-charged-123",
  additional_source_urls: [],
  date: "2024-02-01",
  summary: "Was charged with cheating.",
  match_confidence: "strong",
  match_evidence: "Same name, age 43, director of Acme Trading.",
  historical: false,
  ...over,
});

const seen = (...urls: string[]) => new Set(urls.map((u) => u.replace("www.", "")));

describe("ModelScreenSchema", () => {
  it("accepts the documented JSON shape and defaults missing optionals", () => {
    const r = parseJson(
      ModelScreenSchema,
      JSON.stringify({
        findings: [{ ...modelFinding(), additional_source_urls: undefined, historical: undefined }],
        overall_note: "One report found.",
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.findings[0]).toMatchObject({ additional_source_urls: [], historical: false });
  });

  it("rejects bad categories, confidence levels and URLs", () => {
    const bad = (f: object) => parseJson(ModelScreenSchema, JSON.stringify({ findings: [{ ...modelFinding(), ...f }] })).ok;
    expect(bad({ category: "gossip" })).toBe(false);
    expect(bad({ match_confidence: "certain" })).toBe(false);
    expect(bad({ source_url: "not a url" })).toBe(false);
  });

  it("falls back to unknown stage and null date rather than failing", () => {
    const r = parseJson(ModelScreenSchema, JSON.stringify({ findings: [modelFinding({ case_stage: "sentenced" as never, date: "Feb 2024" })] }));
    expect(r.ok && r.data.findings[0]).toMatchObject({ case_stage: "unknown", date: null });
  });

  it("extracts JSON from fenced or chatty output", () => {
    expect(parseJson(ModelScreenSchema, 'Here you go:\n```json\n{"findings": []}\n```').ok).toBe(true);
    expect(parseJson(ModelScreenSchema, "Sorry, I could not do that.").ok).toBe(false);
  });
});

describe("groundFindings", () => {
  const data = (findings: ModelScreen["findings"]): ModelScreen => ({ searches_run: [], findings, overall_note: "" });

  it("drops findings whose URL never appeared in search or fetch results", () => {
    const out = groundFindings({
      data: data([modelFinding(), modelFinding({ source_url: "https://invented.example.com/story" })]),
      seenUrls: seen("https://channelnewsasia.com/singapore/director-charged-123"),
    });
    expect(out.map((f) => f.sourceUrl)).toEqual(["https://www.channelnewsasia.com/singapore/director-charged-123"]);
  });

  it("keeps only additional URLs that were seen", () => {
    const [f] = groundFindings({
      data: data([modelFinding({ additional_source_urls: ["https://straitstimes.com/a", "https://made-up.example/b"] })]),
      seenUrls: seen("https://channelnewsasia.com/singapore/director-charged-123", "https://straitstimes.com/a"),
    });
    expect(f!.additionalSourceUrls).toEqual(["https://straitstimes.com/a"]);
  });

  it("strips personal identifiers from model text", () => {
    const [f] = groundFindings({
      data: data([modelFinding({ summary: "Tan (S1234567D, 91234567) was charged.", match_evidence: "Email tan@x.com matches." })]),
      seenUrls: seen("https://channelnewsasia.com/singapore/director-charged-123"),
    });
    expect(f!.summary).not.toMatch(/S1234567D|91234567/);
    expect(f!.matchEvidence).not.toContain("tan@x.com");
  });

  it("marks findings older than 10 years as historical", () => {
    const [f] = groundFindings(
      { data: data([modelFinding({ date: "2014-01-01" })]), seenUrls: seen("https://channelnewsasia.com/singapore/director-charged-123") },
      new Date("2026-11-03"),
    );
    expect(f!.historical).toBe(true);
  });
});

const finding = (over: Partial<Finding>): Finding => ({
  category: "local_media",
  caseStage: "charged",
  title: "t",
  sourceName: "CNA",
  sourceUrl: "https://cna.example/1",
  additionalSourceUrls: [],
  date: "2024-01-01",
  summary: "s",
  matchConfidence: "possible",
  matchEvidence: "e",
  historical: false,
  ...over,
});

describe("mergeFindings", () => {
  it("merges findings that share a URL, keeping every URL, the best confidence and the final outcome", () => {
    const merged = mergeFindings([
      [finding({ sourceUrl: "https://cna.example/1", caseStage: "charged", matchConfidence: "possible" })],
      [
        finding({
          sourceUrl: "https://st.example/9",
          additionalSourceUrls: ["https://www.cna.example/1/"],
          caseStage: "acquitted",
          matchConfidence: "strong",
          date: "2025-06-01",
        }),
        finding({ sourceUrl: "https://other.example/x" }),
      ],
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ caseStage: "acquitted", matchConfidence: "strong", sourceUrl: "https://st.example/9", date: "2025-06-01" });
    expect(merged[0]!.additionalSourceUrls).toContain("https://cna.example/1");
  });

  it("never downgrades a conviction to a charge", () => {
    const [m] = mergeFindings([[finding({ caseStage: "convicted" })], [finding({ caseStage: "charged" })]]);
    expect(m!.caseStage).toBe("convicted");
  });
});

describe("splitByConfidence", () => {
  it("puts weak findings in the appendix only when there are 3 or fewer", () => {
    const strong = finding({ matchConfidence: "strong", sourceUrl: "https://a/1" });
    const weak = (n: number) => Array.from({ length: n }, (_, i) => finding({ matchConfidence: "weak", sourceUrl: `https://w/${i}` }));

    const few = splitByConfidence([strong, ...weak(3)]);
    expect(few.findings).toEqual([strong]);
    expect(few.unlikelyMatches).toHaveLength(3);
    expect(few.unlikelyOmitted).toBe(0);

    const many = splitByConfidence([strong, ...weak(4)]);
    expect(many.unlikelyMatches).toHaveLength(0);
    expect(many.unlikelyOmitted).toBe(4);
  });
});
