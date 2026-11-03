import { describe, expect, it } from "vitest";
import { NRIC_MESSAGE, containsNricLike, personNameProblem, stripPii } from "@/lib/person/pii";
import { PersonInputSchema } from "@/lib/person/schema";
import { validInput } from "./fixtures/person";

const issues = (raw: unknown) => {
  const r = PersonInputSchema.safeParse(raw);
  return r.success ? [] : r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
};

describe("PersonInputSchema", () => {
  it("accepts a valid person and normalises whitespace", () => {
    const r = PersonInputSchema.parse({ ...validInput, fullName: "  Tan   Wei  Ming " });
    expect(r.fullName).toBe("Tan Wei Ming");
    expect(r.nativeName).toBe("陈伟明");
  });

  it("drops empty optionals so the canonical form is stable", () => {
    const r = PersonInputSchema.parse({ ...validInput, occupation: "", company: "  ", nativeName: "" });
    expect(r.occupation).toBeUndefined();
    expect(r.company).toBeUndefined();
    expect(r.nativeName).toBeUndefined();
  });

  it.each(["fullName", "nationality", "occupation", "company"] as const)("rejects an NRIC/FIN in %s", (field) => {
    const found = issues({ ...validInput, [field]: "Tan S1234567D" });
    expect(found).toContainEqual({ path: field, message: NRIC_MESSAGE });
  });

  it("rejects an NRIC/FIN in an alias and in the native-script name", () => {
    expect(issues({ ...validInput, aliases: ["G 1234567 X"] })).toContainEqual({ path: "aliases.0", message: NRIC_MESSAGE });
    expect(issues({ ...validInput, nativeName: "T7654321Z" }).map((i) => i.message)).toContain(NRIC_MESSAGE);
  });

  it("has no field for ID numbers and rejects unknown keys", () => {
    expect(issues({ ...validInput, nric: "S1234567D" }).length).toBeGreaterThan(0);
    expect(issues({ ...validInput, passport: "E1234567" }).length).toBeGreaterThan(0);
  });

  it("needs only the full name (and the consent confirmation)", () => {
    const r = PersonInputSchema.parse({ fullName: "Tan Wei Ming", consent: true });
    expect(r).toMatchObject({ fullName: "Tan Wei Ming", aliases: [] });
    expect(r.dob).toBeUndefined();
    expect(r.nationality).toBeUndefined();
    expect(r.purpose).toBeUndefined();
    // Blank form fields arrive as empty strings.
    expect(PersonInputSchema.safeParse({ fullName: "Tan Wei Ming", dob: "", nationality: "", purpose: "", consent: true }).success).toBe(true);
    expect(issues({ consent: true }).map((i) => i.path)).toContain("fullName");
  });

  it("still requires the consent confirmation and rejects unknown purposes", () => {
    expect(issues({ ...validInput, consent: false }).map((i) => i.path)).toContain("consent");
    expect(issues({ ...validInput, purpose: "stalking" }).map((i) => i.path)).toContain("purpose");
  });

  it("limits aliases to 3 and checks dates of birth", () => {
    expect(issues({ ...validInput, aliases: ["Aa Bb", "Cc Dd", "Ee Ff", "Gg Hh"] }).map((i) => i.path)).toContain("aliases");
    expect(issues({ ...validInput, dob: "1980-02-30" }).map((i) => i.path)).toContain("dob");
    expect(issues({ ...validInput, dob: "1890-01-01" }).map((i) => i.path)).toContain("dob");
    expect(issues({ ...validInput, dob: "17/05/1980" }).map((i) => i.path)).toContain("dob");
  });

  it("length-limits free text", () => {
    expect(issues({ ...validInput, company: "x".repeat(121) }).map((i) => i.path)).toContain("company");
  });
});

describe("personNameProblem", () => {
  it.each(["Tan Wei Ming", "Siti Nurhaliza binte Abdullah", "Rajesh s/o Kumar".replace("/", ""), "O'Brien-Lee", "陈伟明", "Zoë Müller"])(
    "accepts %s",
    (n) => expect(personNameProblem(n)).toBeNull(),
  );

  it.each([
    ["Acme Pte Ltd", "company"],
    ["Tan 123", "letters"],
    ["https://example.com", "letters"],
    ["x", "full name"],
    ["Bob@mail", "letters"],
  ])("rejects %s", (n, hint) => expect(personNameProblem(n)).toMatch(new RegExp(hint, "i")));
});

describe("containsNricLike", () => {
  it.each(["S1234567D", "t1234567j", "F 1234567 N", "M1234567-K", "id: G1234567X"])("flags %s", (v) =>
    expect(containsNricLike(v)).toBe(true),
  );
  it.each(["1234567", "S12345678D", "Tan Wei Ming", "2023 SGHC 123"])("ignores %s", (v) => expect(containsNricLike(v)).toBe(false));
});

describe("stripPii", () => {
  it("removes NRIC/FIN, emails and phone numbers", () => {
    const out = stripPii("Tan (S1234567D) can be reached at tan@example.com, +65 9123 4567 or 61234567, +44 20 7946 0958.");
    expect(out).not.toMatch(/S1234567D|tan@example|9123|61234567|7946/);
    expect(out).toContain("[ID removed]");
    expect(out).toContain("[email removed]");
    expect(out).toContain("[phone removed]");
  });

  it("leaves dates, case citations and money alone", () => {
    const text = "Fined S$90,000 on 2021-03-04 in [2023] SGHC 123; 12 months' jail.";
    expect(stripPii(text)).toBe(text);
  });
});
