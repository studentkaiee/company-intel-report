import { describe, expect, it } from "vitest";
import { missingQueries, officialQueries, otherQueries, requiredSearchBlock } from "@/lib/person/queries";
import { PersonInputSchema } from "@/lib/person/schema";
import { validInput } from "./fixtures/person";

const subject = (over: object = {}) => PersonInputSchema.parse({ ...validInput, ...over });

describe("required searches", () => {
  it("never use site: (the search provider ignores it)", () => {
    const s = subject();
    expect([...officialQueries(s), ...otherQueries(s)].some((q) => q.includes("site:"))).toBe(false);
  });

  it("search official Singapore sources for the name, criminal case titles and each alias", () => {
    const q = officialQueries(subject({ aliases: ["William Tan"] }));
    expect(q).toContain('"Tan Wei Ming"');
    expect(q).toContain('"Tan Wei Ming" "Public Prosecutor"');
    expect(q).toContain('"Tan Wei Ming" enforcement OR "prohibition order" OR "investor alert" OR penalty');
    expect(q).toContain('"William Tan" "Public Prosecutor"');
    expect(q).toHaveLength(7);
  });

  it("search the wider web for legal and regulatory matters, not news", () => {
    const q = otherQueries(subject({ aliases: [] }));
    expect(q).toEqual([
      '"Tan Wei Ming" court Singapore',
      '"Tan Wei Ming" fraud OR scam OR sued OR fined OR sanctioned',
      '"Tan Wei Ming" regulator OR enforcement OR disqualified',
    ]);
  });

  it("work with only a name", () => {
    const s = PersonInputSchema.parse({ fullName: "Tan Wei Ming", consent: true });
    expect(officialQueries(s)).toHaveLength(5);
    expect(otherQueries(s)).toHaveLength(3);
  });

  it("match run queries ignoring case, quotes and spacing", () => {
    const required = ['"Tan Wei Ming" court Singapore', '"Tan Wei Ming"'];
    expect(missingQueries(required, ["tan wei ming  court singapore"])).toEqual(['"Tan Wei Ming"']);
  });

  it("are numbered in the prompt", () => {
    expect(requiredSearchBlock(["a", "b"])).toMatch(/1\. a\n2\. b$/);
  });
});
