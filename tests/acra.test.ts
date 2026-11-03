import { describe, expect, it, vi } from "vitest";
import { ACRA_RESOURCE_ID, cleanNameQuery, lookupUen, parseAcraResponse, rankCandidates, searchAcra } from "@/lib/acra";

const record = (overrides: Record<string, unknown> = {}) => ({
  _id: 1,
  uen: "201912345K",
  issuance_agency_desc: "ACRA",
  uen_status_desc: "Registered",
  entity_name: "ACME TRADING PTE. LTD.",
  entity_type_desc: "Local Company",
  uen_issue_date: "2019-04-01",
  reg_street_name: "ROBINSON ROAD",
  reg_postal_code: "068900",
  ...overrides,
});

const body = (records: unknown[]) => ({ success: true, result: { records, total: records.length } });

function mockFetch(json: unknown, ok = true) {
  return vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => json }) as unknown as typeof fetch;
}

describe("parseAcraResponse", () => {
  it("maps registry fields", () => {
    expect(parseAcraResponse(body([record()]))).toEqual([
      {
        uen: "201912345K",
        entityName: "ACME TRADING PTE. LTD.",
        status: "Registered",
        entityType: "Local Company",
        registrationDate: "2019-04-01",
        address: "ROBINSON ROAD, Singapore 068900",
        issuanceAgency: "ACRA",
        source: expect.stringContaining("ACRA"),
      },
    ]);
  });

  it("skips malformed records and duplicate UENs", () => {
    const out = parseAcraResponse(body([record(), record(), { entity_name: "no uen" }, record({ uen: "53000000A" })]));
    expect(out.map((r) => r.uen)).toEqual(["201912345K", "53000000A"]);
  });

  it("handles missing address fields", () => {
    expect(parseAcraResponse(body([record({ reg_street_name: null, reg_postal_code: null })]))[0]?.address).toBe("");
  });

  it("throws on an unexpected payload", () => {
    expect(() => parseAcraResponse({ success: false })).toThrow();
  });
});

describe("rankCandidates", () => {
  it("puts exact and prefix matches first, live entities above deregistered ones", () => {
    const facts = parseAcraResponse(
      body([
        record({ uen: "1", entity_name: "BIG ACME HOLDINGS", uen_status_desc: "Registered" }),
        record({ uen: "2", entity_name: "ACME", uen_status_desc: "Deregistered" }),
        record({ uen: "3", entity_name: "ACME TRADING", uen_status_desc: "Live Company" }),
      ]),
    );
    expect(rankCandidates("acme", facts).map((f) => f.uen)).toEqual(["2", "3", "1"]);
  });
});

describe("network calls", () => {
  it("searchAcra queries the dataset and caps at 10 results", async () => {
    const records = Array.from({ length: 15 }, (_, i) => record({ uen: `20190000${String(i).padStart(2, "0")}K` }));
    const f = mockFetch(body(records));
    const out = await searchAcra("acme", f);
    expect(out).toHaveLength(10);
    const url = new URL(String((f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]));
    expect(url.searchParams.get("resource_id")).toBe(ACRA_RESOURCE_ID);
    expect(JSON.parse(url.searchParams.get("q") ?? "{}")).toEqual({ entity_name: "acme" });
  });

  it("strips legal suffixes and punctuation from the name query", () => {
    expect(cleanNameQuery("Acme Trading Pte. Ltd.")).toBe("Acme Trading");
    expect(cleanNameQuery("ACME PRIVATE LIMITED")).toBe("ACME");
    expect(cleanNameQuery("  Foo & Bar (S) Pte Ltd ")).toBe("Foo & Bar S");
    expect(cleanNameQuery("Ltd")).toBe("Ltd");
  });

  it("lookupUen filters by UEN and returns null when not found", async () => {
    const f = mockFetch(body([]));
    expect(await lookupUen("201912345k", f)).toBeNull();
    const url = new URL(String((f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]));
    expect(JSON.parse(url.searchParams.get("filters") ?? "{}")).toEqual({ uen: "201912345K" });
  });

  it("lookupUen rejects malformed UENs before calling the network", async () => {
    const f = mockFetch(body([]));
    await expect(lookupUen("x'; drop", f)).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });

  it("retries once, then surfaces HTTP errors", async () => {
    const f = mockFetch({}, false);
    await expect(searchAcra("acme", f)).rejects.toThrow("HTTP 500");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("recovers when the retry succeeds", async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => body([record()]) }) as unknown as typeof fetch;
    expect(await searchAcra("acme", f)).toHaveLength(1);
  });
});
