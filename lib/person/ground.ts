import { normalizeUrl } from "../report-schema";
import { SG_COURT_RECORD_SOURCES, SG_OFFICIAL_SOURCES, onDomain } from "./outlets";
import { stripPii } from "./pii";
import type { CaseStage, Finding, MatchConfidence, ModelScreen } from "./schema";

/** One research call's validated output plus every URL that appeared in its search or fetch results. */
export type CallResult = { data: ModelScreen; seenUrls: Set<string> };

const STAGE_RANK: Record<CaseStage, number> = {
  unknown: 0,
  allegation: 1,
  investigation: 2,
  civil_claim: 3,
  charged: 4,
  settled: 5,
  convicted: 6,
  // A later acquittal or withdrawal outranks everything: it is the final outcome.
  acquitted: 7,
  withdrawn: 7,
};
const CONFIDENCE_RANK: Record<MatchConfidence, number> = { weak: 0, possible: 1, strong: 2 };

const HISTORICAL_YEARS = 10;

/**
 * Turns model findings into report findings:
 * - drops any finding whose source URL never appeared in that call's web results, and any extra URL that didn't;
 * - strips NRIC/FIN-like values, emails and phone numbers from model text;
 * - marks findings older than 10 years as historical.
 */
export function groundFindings({ data, seenUrls }: CallResult, now = new Date()): Finding[] {
  const seen = (u: string) => seenUrls.has(normalizeUrl(u));
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - HISTORICAL_YEARS);

  return data.findings
    .filter((f) => seen(f.source_url))
    .map((f) => ({
      category: f.category,
      caseStage: f.case_stage,
      title: stripPii(f.title),
      sourceName: stripPii(f.source_name),
      sourceUrl: f.source_url,
      additionalSourceUrls: [...new Set(f.additional_source_urls.filter((u) => u !== f.source_url && seen(u)))],
      date: f.date,
      summary: stripPii(f.summary),
      matchConfidence: f.match_confidence,
      matchEvidence: stripPii(f.match_evidence),
      historical: f.historical || (f.date !== null && new Date(`${f.date}T00:00:00Z`) < cutoff),
    }))
    .map(courtRecordsAreStrong);
}

export const COURT_RECORD_NOTE = "Named in an official Singapore court record (judiciary.gov.sg / eLitigation).";

const urlsOf = (f: Finding) => [f.sourceUrl, ...f.additionalSourceUrls];

/** Product rule: a person found in an official Singapore court record is a strong match. */
function courtRecordsAreStrong(f: Finding): Finding {
  if (!urlsOf(f).some((u) => onDomain(u, SG_COURT_RECORD_SOURCES)) || f.matchConfidence === "strong") return f;
  return { ...f, matchConfidence: "strong", matchEvidence: `${COURT_RECORD_NOTE} ${f.matchEvidence}`.trim() };
}

/** Findings from Singapore courts and regulators come first. */
const isOfficialSg = (f: Finding) => urlsOf(f).some((u) => onDomain(u, SG_OFFICIAL_SOURCES));

/**
 * Merges findings from several calls. Findings that share any URL are the same story: they become one finding
 * with every URL, the highest match confidence and the furthest case stage (acquittal/withdrawal wins).
 */
export function mergeFindings(lists: Finding[][]): Finding[] {
  const merged: { finding: Finding; urls: Set<string> }[] = [];
  for (const f of lists.flat()) {
    const urls = new Set([f.sourceUrl, ...f.additionalSourceUrls].map(normalizeUrl));
    const into = merged.find((m) => [...urls].some((u) => m.urls.has(u)));
    if (!into) {
      merged.push({ finding: { ...f }, urls });
      continue;
    }
    const a = into.finding;
    const base = CONFIDENCE_RANK[f.matchConfidence] > CONFIDENCE_RANK[a.matchConfidence] ? f : a;
    const allUrls = [...new Set([a.sourceUrl, ...a.additionalSourceUrls, f.sourceUrl, ...f.additionalSourceUrls])];
    into.finding = {
      ...base,
      caseStage: STAGE_RANK[f.caseStage] > STAGE_RANK[a.caseStage] ? f.caseStage : a.caseStage,
      additionalSourceUrls: allUrls.filter((u) => u !== base.sourceUrl),
      historical: a.historical && f.historical,
      date: [a.date, f.date].filter((d): d is string => !!d).sort().at(-1) ?? null,
    };
    for (const u of urls) into.urls.add(u);
  }
  return merged.map((m) => m.finding);
}

export const MAX_UNLIKELY_SHOWN = 3;

/** Strong and possible findings go in the report body; weak ones go to an appendix only when there are 3 or fewer. */
export function splitByConfidence(findings: Finding[]) {
  const sorted = [...findings].sort(
    (x, y) =>
      CONFIDENCE_RANK[y.matchConfidence] - CONFIDENCE_RANK[x.matchConfidence] ||
      Number(isOfficialSg(y)) - Number(isOfficialSg(x)) ||
      (y.date ?? "").localeCompare(x.date ?? ""),
  );
  const main = sorted.filter((f) => f.matchConfidence !== "weak");
  const weak = sorted.filter((f) => f.matchConfidence === "weak");
  return weak.length <= MAX_UNLIKELY_SHOWN
    ? { findings: main, unlikelyMatches: weak, unlikelyOmitted: 0 }
    : { findings: main, unlikelyMatches: [], unlikelyOmitted: weak.length };
}
