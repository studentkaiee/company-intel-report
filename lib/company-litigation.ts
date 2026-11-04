import { cleanNameQuery } from "./acra";
import type { UsageTracker } from "./cost";
import type { ProgressEvent } from "./ndjson";
import { splitByConfidence } from "./person/ground";
import { SG_OFFICIAL_SOURCES } from "./person/outlets";
import { COMMON_RULES, MAX_FETCHES_PER_CALL, runScreen, type ScreenOptions } from "./person/research";
import { screenCompanySanctions } from "./person/sanctions";
import type { Litigation } from "./report-schema";
import type { Target } from "./research";

/**
 * The company report's litigation check. Same logic as the Individual Legal Screen: Singapore court and regulator
 * sites first (allowed_domains), then the wider web with Singapore news media blocked; a required search list per
 * call; findings grounded in each call's own web results; anything on judiciary.gov.sg / eLitigation is a strong
 * match; plus sanctions screening of the company name against the UN and OFAC entity lists.
 */

export const LITIGATION_MODEL = "claude-sonnet-5-5";

const q = (name: string, rest = "") => `"${name}"${rest ? ` ${rest}` : ""}`;

function names(t: Target) {
  const full = t.registry?.entityName || t.companyName;
  const short = cleanNameQuery(full);
  return { full, short: short.toLowerCase() === full.toLowerCase() ? null : short };
}

/** Searched within Singapore court and regulator sites. */
export function companyOfficialQueries(t: Target): string[] {
  const { full, short } = names(t);
  return [
    q(full),
    ...(short ? [q(short)] : []),
    q(short ?? full, 'judgment OR appeal OR "winding up" OR tribunal'),
    q(short ?? full, '"Public Prosecutor"'),
    q(full, 'enforcement OR penalty OR "prohibition order" OR "investor alert" OR composition'),
    q(full, '"judicial management" OR liquidation OR insolvency OR "struck off"'),
    ...(t.uen ? [q(t.uen)] : []),
  ];
}

/** Searched on the open web, with Singapore news media blocked. */
export function companyOtherQueries(t: Target): string[] {
  const { full, short } = names(t);
  return [
    q(full, "court Singapore"),
    q(short ?? full, "lawsuit OR sued OR claim OR arbitration"),
    q(short ?? full, "fraud OR fined OR sanctioned OR enforcement"),
  ];
}

const COMPANY_NOTES = `This screen is about a company, not an individual. Where the rules below mention a person, read "the company". Identify the company by its UEN, registered address, former names and business, not by age; note in match_evidence whether these agree. Do not mention spent convictions for companies. Officers may be named only as they appear in the record (name and role).
Report only matters where the company itself is a party (plaintiff, defendant, applicant, respondent, accused, company being wound up, or entity sanctioned), not cases that merely cite or mention it.`;

const OFFICIAL_SYSTEM = `You search official Singapore court and regulator websites for litigation, court history and regulatory actions involving a named company, for a Singapore due-diligence report. Your tools can only reach these sites: ${SG_OFFICIAL_SOURCES.join(", ")}. You will be given a list of required searches; run all of them, then follow up leads with a few more searches and up to ${MAX_FETCHES_PER_CALL} page fetches. Fetch judgments that look relevant so you can read the parties and facts.
Cover:
1. Singapore court judgments, hearing lists and cause lists naming the company as a party: civil suits, appeals, winding-up and judicial management applications, insolvency, criminal cases ("Public Prosecutor v <company>"). Category "court_judgment". Use case_stage "civil_claim" or "settled" for civil matters and record who won if the judgment says.
2. MAS enforcement actions and the MAS Investor Alert List (categories "regulatory_action" and "investor_alert").
3. Other Singapore regulator actions: SGX RegCo, ACRA (including striking off and prosecutions), CCCS, PDPC, MOM, the Police, AGC. Category "regulatory_action".
A company named as a party in a judgment or hearing list on judiciary.gov.sg or elitigation.sg is always rated "strong".
${COMPANY_NOTES}

${COMMON_RULES}`;

const OTHER_SYSTEM = `You search the wider web for litigation, court records and regulatory actions involving a named company, for a Singapore due-diligence report. You will be given a list of required searches; run all of them, then follow up leads with a few more searches and up to ${MAX_FETCHES_PER_CALL} page fetches.
Singapore news media are deliberately excluded and blocked: do not look for or report Singapore newspaper or news-site articles. Focus on court records, arbitration awards, regulator and enforcement notices, sanctions or debarment registers, and other primary legal sources, in Singapore or elsewhere. Use category "court_judgment", "regulatory_action" or "other".
${COMPANY_NOTES}

${COMMON_RULES}`;

export function describeCompany(t: Target, today = new Date()): string {
  const { full } = names(t);
  const lines = [`Company name: ${full}`];
  if (t.uen) lines.push(`UEN: ${t.uen}`);
  if (t.registry) {
    lines.push(`Registered address: ${t.registry.address || "unknown"}`);
    lines.push(`Entity type: ${t.registry.entityType || "unknown"}; status: ${t.registry.status || "unknown"}`);
    if (t.registry.registrationDate) lines.push(`Registered on: ${t.registry.registrationDate}`);
  }
  if (t.website) lines.push(`Website: ${t.website}`);
  lines.push(`Today's date: ${today.toISOString().slice(0, 10)}`);
  return lines.join("\n");
}

export async function companyLitigation(
  t: Target,
  onEvent: (e: ProgressEvent<never>) => void,
  usage?: UsageTracker,
  client?: ScreenOptions["client"],
): Promise<Litigation> {
  const { full, short } = names(t);
  const sanctions = screenCompanySanctions([full, ...(short ? [short] : [])]);
  onEvent({ type: "status", message: "Checking Singapore court records and regulators…" });
  const prompt = describeCompany(t);
  const research = await runScreen(
    [
      { label: "Singapore court and regulator", model: LITIGATION_MODEL, system: OFFICIAL_SYSTEM, prompt, required: companyOfficialQueries(t), effort: "high", allowedDomains: SG_OFFICIAL_SOURCES },
      { label: "other legal source", model: LITIGATION_MODEL, system: OTHER_SYSTEM, prompt, required: companyOtherQueries(t), effort: "medium" },
    ],
    { onEvent, usage, client },
  );
  return {
    sanctions,
    ...splitByConfidence(research.findings),
    searchesRun: research.searchesRun,
    overallNote: research.overallNote,
  };
}
