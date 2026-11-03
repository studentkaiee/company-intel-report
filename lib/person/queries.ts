import type { PersonInput } from "./schema";

/**
 * Minimum searches each research call must run before it may answer. Built in code so coverage doesn't depend on
 * the model deciding to look: in testing, a call stopped after 3 of 12 allowed searches.
 * Plain keyword queries only: the search provider ignores `site:`, so sites are chosen with the tool's
 * `allowed_domains` / `blocked_domains` instead (see research.ts).
 */

const q = (name: string, rest = "") => `"${name}"${rest ? ` ${rest}` : ""}`;

/** Searched within Singapore court and regulator sites. Criminal cases are titled "Public Prosecutor v <name>". */
export function officialQueries(s: PersonInput): string[] {
  return [
    q(s.fullName),
    q(s.fullName, '"Public Prosecutor"'),
    q(s.fullName, "judgment OR appeal OR tribunal"),
    q(s.fullName, 'enforcement OR "prohibition order" OR "investor alert" OR penalty'),
    q(s.fullName, "disciplinary OR struck off OR suspended OR convicted"),
    ...s.aliases.flatMap((a) => [q(a), q(a, '"Public Prosecutor"')]),
  ];
}

/** Searched on the open web, with Singapore news media blocked. */
export function otherQueries(s: PersonInput): string[] {
  return [
    q(s.fullName, "court Singapore"),
    q(s.fullName, "fraud OR scam OR sued OR fined OR sanctioned"),
    q(s.fullName, "regulator OR enforcement OR disqualified"),
    ...s.aliases.map((a) => q(a, "court OR fraud OR fined")),
  ];
}

/** Extra searches allowed beyond the required ones, for following up leads. */
export const FOLLOW_UP_SEARCHES = 6;

const norm = (s: string) => s.toLowerCase().replace(/["“”']/g, "").replace(/\s+/g, " ").trim();

/** Required queries that weren't run (compared case- and quote-insensitively). */
export function missingQueries(required: string[], run: string[]): string[] {
  const ran = new Set(run.map(norm));
  return required.filter((r) => !ran.has(norm(r)));
}

export function requiredSearchBlock(required: string[]): string {
  return [
    "Required searches. Run every one of these with web_search, exactly as written, before you answer.",
    "After that you may run up to " + FOLLOW_UP_SEARCHES + " more searches and fetch pages to follow up leads.",
    ...required.map((r, i) => `${i + 1}. ${r}`),
  ].join("\n");
}
