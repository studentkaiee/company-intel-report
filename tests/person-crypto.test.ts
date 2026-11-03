import { describe, expect, it } from "vitest";
import { canonicalJson, hmacHex, verificationCode } from "@/lib/person/canonical";
import { inputHash } from "@/lib/person/gate";
import { buildPersonReport, verifyReportSignature } from "@/lib/person/report";
import { PersonInputSchema, findingCounts, verificationFields } from "@/lib/person/schema";
import { validInput } from "./fixtures/person";

const SECRET = "test-hmac-secret-for-person-screen-long-enough";

describe("canonicalJson", () => {
  it("sorts keys at every level and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[{"y":2,"z":1}]},"b":1}');
  });

  it("gives the same output regardless of key order", () => {
    expect(canonicalJson({ x: 1, y: [1, 2] })).toBe(canonicalJson({ y: [1, 2], x: 1 }));
  });
});

describe("hmacHex", () => {
  it("is stable, keyed and separated by purpose", () => {
    const v = { a: 1 };
    expect(hmacHex("input", v, SECRET)).toBe(hmacHex("input", { a: 1 }, SECRET));
    expect(hmacHex("input", v, SECRET)).toMatch(/^[0-9a-f]{64}$/);
    expect(hmacHex("input", v, SECRET)).not.toBe(hmacHex("report", v, SECRET));
    expect(hmacHex("input", v, SECRET)).not.toBe(hmacHex("input", v, `${SECRET}x`));
  });
});

describe("inputHash", () => {
  const inputs = PersonInputSchema.parse(validInput);

  it("is the same for the same details typed with different spacing", () => {
    const again = PersonInputSchema.parse({ ...validInput, fullName: " Tan  Wei Ming " });
    expect(inputHash(again)).toBe(inputHash(inputs));
  });

  it("changes when any detail changes", () => {
    expect(inputHash(PersonInputSchema.parse({ ...validInput, dob: "1980-05-18" }))).not.toBe(inputHash(inputs));
    expect(inputHash(PersonInputSchema.parse({ ...validInput, aliases: [] }))).not.toBe(inputHash(inputs));
  });

  it("contains no readable personal data", () => {
    expect(inputHash(inputs)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("report signature and verification code", () => {
  const inputs = PersonInputSchema.parse(validInput);
  const { report, signature } = buildPersonReport(
    inputs,
    { status: "no_match", lists: [] },
    { findings: [], searchesRun: ["Tan Wei Ming court"], overallNote: "Nothing found." },
    { reportId: "ILS-0123456789", now: new Date("2026-11-03T02:00:00Z"), secret: SECRET },
  );

  it("verifies an untouched report and rejects any edit", () => {
    expect(verifyReportSignature(report, signature, SECRET)).not.toBeNull();
    expect(verifyReportSignature(JSON.parse(JSON.stringify(report)), signature, SECRET)).not.toBeNull();
    expect(verifyReportSignature({ ...report, overallNote: "Clean." }, signature, SECRET)).toBeNull();
    expect(verifyReportSignature(report, signature.replace(/.$/, "0"), SECRET)).toBeNull();
    expect(verifyReportSignature({ junk: true }, signature, SECRET)).toBeNull();
  });

  it("produces a typeable code that the verify fields reproduce", () => {
    expect(report.verificationCode).toMatch(/^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
    const fields = verificationFields({
      reportId: "ils-0123456789",
      fullName: "tan wei  ming",
      dob: "1980-05-17",
      ...findingCounts(report),
      sanctions: "no_match",
    });
    expect(verificationCode(fields, SECRET)).toBe(report.verificationCode);
    expect(verificationCode({ ...fields, strong: 1 }, SECRET)).not.toBe(report.verificationCode);
  });
});
