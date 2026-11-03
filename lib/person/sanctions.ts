import { readFileSync } from "node:fs";
import path from "node:path";
import type { PersonInput, SanctionsListResult, SanctionsResult } from "./schema";

/**
 * Deterministic sanctions screening against static lists shipped with the app (data/sanctions/*.json,
 * refreshed by scripts/update-sanctions.mjs). No network calls and nothing stored.
 */

export type SanctionsEntry = {
  id: string;
  names: string[];
  birthYears: number[];
  birthDates: string[];
  nationalities: string[];
  program: string;
};

export type SanctionsList = { list: string; name: string; source: string; asOf: string; entries: SanctionsEntry[] };

const LIST_FILES = ["un.json", "ofac.json", "tsofa.json"];

let loaded: SanctionsList[] | undefined;

export function loadSanctionsLists(): SanctionsList[] {
  loaded ??= LIST_FILES.map(
    (f) => JSON.parse(readFileSync(path.join(process.cwd(), "data", "sanctions", f), "utf8")) as SanctionsList,
  );
  return loaded;
}

// Honorifics and connectors that carry no identity.
const STOPWORDS = new Set(["mr", "mrs", "ms", "dr", "haji", "hajjah", "sheikh", "shaykh", "bin", "binti", "bte", "bt", "s/o", "d/o", "al", "el", "abu"]);

export function nameTokens(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

/** Jaro-Winkler similarity, 0..1. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

const TOKEN_THRESHOLD = 0.9;

/**
 * Order-insensitive name comparison (handles "Tan Wei Ming" vs "Wei Ming Tan"). Every token of the shorter name
 * must closely match a distinct token of the longer one, and both names need at least two tokens unless they are
 * identical. Returns the average token similarity, or 0 for no match.
 */
export function nameScore(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  if (a.length === 1 || b.length === 1) return a.join(" ") === b.join(" ") ? 1 : 0;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const used = new Set<number>();
  let total = 0;
  for (const t of short) {
    let best = 0;
    let bestIdx = -1;
    long.forEach((u, i) => {
      if (used.has(i)) return;
      const s = jaroWinkler(t, u);
      if (s > best) {
        best = s;
        bestIdx = i;
      }
    });
    if (best < TOKEN_THRESHOLD) return 0;
    used.add(bestIdx);
    total += best;
  }
  // A two-token subject matching two of five listed tokens is weaker than a full match.
  const coverage = short.length / long.length;
  return (total / short.length) * (0.85 + 0.15 * coverage);
}

const MATCH_THRESHOLD = 0.88;

function sameCountry(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const x = n(a);
  const y = n(b);
  if (!x || !y) return false;
  // "Singapore" vs "Singaporean", "Malaysia" vs "Malaysian".
  return x.startsWith(y.slice(0, 5)) || y.startsWith(x.slice(0, 5));
}

export function screenList(subject: PersonInput, list: SanctionsList): SanctionsListResult {
  const subjectNames = [subject.fullName, ...subject.aliases].map(nameTokens).filter((t) => t.length);
  const birthYear = subject.dob ? Number(subject.dob.slice(0, 4)) : null;
  const matches: SanctionsListResult["matches"] = [];

  for (const entry of list.entries) {
    let best = 0;
    let bestName = "";
    for (const listed of entry.names) {
      const tokens = nameTokens(listed);
      for (const s of subjectNames) {
        const score = nameScore(s, tokens);
        if (score > best) {
          best = score;
          bestName = listed;
        }
      }
    }
    if (best < MATCH_THRESHOLD) continue;

    // A listed date of birth that clearly differs rules the entry out; with no DOB on either side it stays possible.
    if (birthYear !== null && entry.birthYears.length && !entry.birthYears.some((y) => Math.abs(y - birthYear) <= 1)) continue;

    const reasons = [`name similarity ${Math.round(best * 100)}%`];
    if (birthYear === null) reasons.push("no date of birth given to compare");
    else if (subject.dob && entry.birthDates.includes(subject.dob)) reasons.push("same date of birth");
    else if (entry.birthYears.length) reasons.push("year of birth within 1 year");
    else reasons.push("no date of birth on the list to compare");
    if (entry.nationalities.length && subject.nationality) {
      const nationality = subject.nationality;
      reasons.push(
        entry.nationalities.some((n) => sameCountry(n, nationality))
          ? "same nationality"
          : `listed nationality differs (${entry.nationalities.join(", ")})`,
      );
    }
    matches.push({
      entryId: entry.id,
      listedName: bestName,
      score: Math.round(best * 100) / 100,
      birthYears: entry.birthYears,
      nationalities: entry.nationalities,
      program: entry.program,
      reason: reasons.join("; "),
    });
  }

  matches.sort((x, y) => y.score - x.score);
  return { list: list.list, name: list.name, asOf: list.asOf, checked: list.entries.length > 0, matches: matches.slice(0, 10) };
}

export function screenSanctions(subject: PersonInput, lists: SanctionsList[] = loadSanctionsLists()): SanctionsResult {
  const results = lists.map((l) => screenList(subject, l));
  return { status: results.some((r) => r.matches.length) ? "possible_match" : "no_match", lists: results };
}
