import { describe, expect, it } from "vitest";
import { pdfText, sgtStamp } from "@/lib/pdf/person-document";
import { renderPersonPdf } from "@/lib/pdf/person-render";
import { buildPersonReport } from "@/lib/person/report";
import { PersonInputSchema, type Finding } from "@/lib/person/schema";
import { validInput } from "./fixtures/person";

const finding = (over: Partial<Finding>): Finding => ({
  category: "local_media",
  caseStage: "charged",
  title: "Director charged with cheating",
  sourceName: "CNA",
  sourceUrl: "https://www.channelnewsasia.com/a",
  additionalSourceUrls: ["https://www.zaobao.com.sg/b"],
  date: "2024-02-01",
  summary: "Was charged with cheating; a later report says the charge was withdrawn.",
  matchConfidence: "strong",
  matchEvidence: "Same company and age.",
  historical: false,
  ...over,
});

describe("renderPersonPdf", () => {
  it("renders a report with findings, a sanctions match, an appendix and a non-Latin name", async () => {
    const { report } = buildPersonReport(
      PersonInputSchema.parse(validInput),
      {
        status: "possible_match",
        lists: [
          {
            list: "UN",
            name: "UN Security Council Consolidated List",
            asOf: "2026-11-02",
            checked: true,
            matches: [{ entryId: "UN-X.1", listedName: "TAN WEI MING", score: 0.97, birthYears: [1980], nationalities: [], program: "X", reason: "name similarity 97%" }],
          },
          { list: "TSOFA", name: "TSOFA First Schedule", asOf: "", checked: false, matches: [] },
        ],
      },
      {
        findings: [
          finding({ caseStage: "withdrawn" }),
          finding({ category: "court_judgment", sourceUrl: "https://www.elitigation.sg/x", historical: true, date: "2012-01-01" }),
          finding({ matchConfidence: "weak", sourceUrl: "https://mothership.sg/y" }),
        ],
        searchesRun: ["Tan Wei Ming charged", "陈伟明 控告"],
        overallNote: "One strong match.",
      },
    );
    const pdf = await renderPersonPdf(report);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(3000);
  });
});

describe("renderPersonPdf with only a name", () => {
  it("renders, showing missing details as Not given", async () => {
    const { report } = buildPersonReport(
      PersonInputSchema.parse({ fullName: "Tan Wei Ming", consent: true }),
      { status: "no_match", lists: [] },
      { findings: [], searchesRun: [], overallNote: "" },
    );
    expect(report.subject).toMatchObject({ dob: null, nationality: null });
    expect(report.purpose).toBe("Not given");
    const pdf = await renderPersonPdf(report);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("sgtStamp", () => {
  it("formats as dd-mm-yyyy HH:MM:SS in Singapore time", () => {
    expect(sgtStamp("2026-11-03T08:41:17Z")).toBe("03-11-2026 16:41:17");
    expect(sgtStamp("2026-12-31T20:00:00Z")).toBe("01-01-2027 04:00:00");
  });
});

describe("pdfText", () => {
  it("keeps Latin text and replaces scripts the PDF font can't draw", () => {
    expect(pdfText("Zoë Müller – “quoted”")).toBe("Zoë Müller – “quoted”");
    expect(pdfText("陈伟明")).toBe("(not shown: non-Latin script)");
    expect(pdfText("Tan 陈")).toBe("Tan");
  });
});
