import { describe, expect, it } from "vitest";
import { renderReportPdf } from "@/lib/pdf/render";
import { NO_INFO_NOTE, ReportSchema, SECTION_KEYS } from "@/lib/report-schema";

describe("renderReportPdf", () => {
  it("renders a valid report to a PDF", async () => {
    const report = ReportSchema.parse({
      companyName: "ACME TRADING PTE. LTD.",
      uen: "201912345K",
      website: "https://acme.sg",
      generatedAt: "2026-11-03T08:00:00.000Z",
      registry: {
        uen: "201912345K",
        entityName: "ACME TRADING PTE. LTD.",
        status: "Live Company",
        entityType: "Local Company",
        registrationDate: "2019-04-01",
        address: "ROBINSON ROAD, Singapore 068900",
        issuanceAgency: "ACRA",
        source: "ACRA",
      },
      sections: {
        ...Object.fromEntries(SECTION_KEYS.map((k) => [k, { items: [], confidence: "low", note: NO_INFO_NOTE }])),
        snapshot: { items: [{ text: "Distributes industrial widgets in Singapore.", sourceIds: ["S1"] }], confidence: "high" },
      },
      sources: [{ id: "S1", title: "About ACME", url: "https://acme.sg/about", retrievedAt: "2026-11-03" }],
    });
    const pdf = await renderReportPdf(report);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  }, 30_000);
});
