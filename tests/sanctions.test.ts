import { describe, expect, it } from "vitest";
import { jaroWinkler, loadSanctionsLists, nameScore, nameTokens, screenSanctions, type SanctionsList } from "@/lib/person/sanctions";
import { PersonInputSchema } from "@/lib/person/schema";
import { validInput } from "./fixtures/person";

const list = (entries: SanctionsList["entries"], name = "TEST"): SanctionsList => ({
  list: name,
  name: `${name} list`,
  source: "test",
  asOf: "2026-11-01",
  entries,
});

const entry = (names: string[], over: Partial<SanctionsList["entries"][number]> = {}) => ({
  id: `T-${names[0]}`,
  names,
  birthYears: [],
  birthDates: [],
  nationalities: [],
  program: "TEST",
  ...over,
});

const subject = (over: object = {}) => PersonInputSchema.parse({ ...validInput, aliases: [], ...over });

describe("name matching", () => {
  it("normalises accents, punctuation and honorifics", () => {
    expect(nameTokens("Dr. José  Al-Núñez")).toEqual(["jose", "nunez"]);
  });

  it("is order-insensitive and tolerates small spelling differences", () => {
    expect(nameScore(nameTokens("Tan Wei Ming"), nameTokens("WEI MING TAN"))).toBeGreaterThan(0.95);
    expect(nameScore(nameTokens("Mohamed Ali Hassan"), nameTokens("Mohammed Ali Hasan"))).toBeGreaterThan(0.9);
    expect(nameScore(nameTokens("Tan Wei Ming"), nameTokens("Lim Wei Ming"))).toBe(0);
  });

  it("needs an exact match for one-word names", () => {
    expect(nameScore(["madonna"], ["madonna"])).toBe(1);
    expect(nameScore(["madonna"], ["madonna", "ciccone"])).toBe(0);
  });

  it("computes Jaro-Winkler correctly on a known pair", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 3);
  });
});

describe("screenSanctions", () => {
  it("reports no match when nothing is close", () => {
    const r = screenSanctions(subject(), [list([entry(["John Smith"])])]);
    expect(r.status).toBe("no_match");
    expect(r.lists[0]).toMatchObject({ checked: true, matches: [] });
  });

  it("flags a possible match with reasons, using aliases too", () => {
    const r = screenSanctions(subject({ aliases: ["William Tan"] }), [
      list([entry(["TAN William"], { birthYears: [1980], birthDates: ["1980-05-17"], nationalities: ["Singapore"] })]),
    ]);
    expect(r.status).toBe("possible_match");
    expect(r.lists[0]!.matches[0]!.reason).toMatch(/same date of birth; same nationality/);
  });

  it("rules out a same-name entry with a clearly different year of birth", () => {
    const r = screenSanctions(subject(), [list([entry(["Tan Wei Ming"], { birthYears: [1950] })])]);
    expect(r.status).toBe("no_match");
  });

  it("keeps a same-name entry with no date of birth as a possible match", () => {
    const r = screenSanctions(subject(), [list([entry(["Tan Wei Ming"])])]);
    expect(r.lists[0]!.matches[0]!.reason).toContain("no date of birth on the list");
  });

  it("without a date of birth, keeps same-name entries as possible matches and says why", () => {
    const nameOnly = PersonInputSchema.parse({ fullName: "Tan Wei Ming", consent: true });
    const r = screenSanctions(nameOnly, [list([entry(["Tan Wei Ming"], { birthYears: [1950], nationalities: ["Malaysia"] })])]);
    expect(r.status).toBe("possible_match");
    expect(r.lists[0]!.matches[0]!.reason).toBe("name similarity 100%; no date of birth given to compare");
  });

  it("reports an empty list as not checked", () => {
    expect(screenSanctions(subject(), [list([])]).lists[0]!.checked).toBe(false);
  });

  it("loads the bundled UN and OFAC lists", () => {
    const lists = loadSanctionsLists();
    expect(lists.map((l) => l.list)).toEqual(["UN", "OFAC", "TSOFA"]);
    expect(lists[0]!.entries.length).toBeGreaterThan(100);
    expect(lists[1]!.entries.length).toBeGreaterThan(1000);
  });
});
