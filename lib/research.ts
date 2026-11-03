import type Anthropic from "@anthropic-ai/sdk";
import { runResearchAgent } from "./agent";
import type { UsageTracker } from "./cost";
import type { ProgressEvent } from "./ndjson";
import {
  ModelPreviewSchema,
  ModelReportSchema,
  SECTION_KEYS,
  SECTION_TITLES,
  groundSections,
  type ModelPreview,
  type RegistryFacts,
  type Report,
  type Section,
  type SectionKey,
} from "./report-schema";

export const QUICK_MODEL = "claude-haiku-5-5";
export const DEEP_MODEL = "claude-sonnet-5-5";
export const QUICK_MAX_SEARCHES = 5;
export const DEEP_MAX_SEARCHES = 25;
export const DEEP_MAX_FETCHES = 15;

// Sites that need a login or forbid automated access; never research through them.
const BLOCKED_DOMAINS = ["linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com"];

export type Target = { companyName: string; uen: string | null; website: string | null; registry: RegistryFacts | null };

const RULES = `Rules you must follow:
- Research only the one registered entity described below. Many companies share similar names: disambiguate using the UEN, registered address and official website. If a source might be about a different entity, leave it out.
- Summarise in your own words. Never quote more than a short phrase.
- Individuals: officers' and founders' names and roles only. Never include home addresses, photos, personal phone numbers, family details or personal social media profiles.
- Do not use sites that need a login (LinkedIn, Facebook, etc.). Respect robots.txt; if a page is blocked, move on.
- Never invent facts, figures or sources. Every item must cite at least one source id from your "sources" list, and each source must be a URL you actually saw in search or fetch results.
- If you find nothing reliable for a section, return "items": [] and "note": "No public information found".
- Registry facts (UEN, status, registered address, registration date) are supplied separately from the official registry. Do not restate or contradict them; flag apparent inconsistencies under riskFlags instead.
- Output a single JSON object and nothing else: no prose, no markdown, no code fences.`;

function describeTarget(t: Target): string {
  const lines = [`Company name: ${t.companyName}`];
  if (t.uen) lines.push(`UEN (Singapore): ${t.uen}`);
  if (t.registry) {
    lines.push(`Registered address: ${t.registry.address || "unknown"}`);
    lines.push(`Entity type: ${t.registry.entityType || "unknown"}; status: ${t.registry.status || "unknown"}`);
  } else {
    lines.push("This entity was not matched in the Singapore registry; identify it from the web.");
  }
  if (t.website) lines.push(`Known website: ${t.website}`);
  lines.push(`Today's date: ${new Date().toISOString().slice(0, 10)}`);
  return lines.join("\n");
}

const SECTION_SHAPE = `{"items": [{"text": string, "sourceIds": ["S1", ...]}], "confidence": "high" | "medium" | "low", "note"?: string}`;
const SOURCE_SHAPE = `{"id": "S1", "title": string, "url": string, "retrievedAt": "YYYY-MM-DD"}`;

// ---------- Quick scan (free preview) ----------

export async function quickScan(target: Target, onEvent: (e: ProgressEvent<never>) => void, usage?: UsageTracker) {
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    // Haiku uses the basic web search variant; dynamic filtering needs Sonnet/Opus.
    { type: "web_search_20250305", name: "web_search", max_uses: QUICK_MAX_SEARCHES, blocked_domains: BLOCKED_DOMAINS },
  ];
  const others = SECTION_KEYS.filter((k) => k !== "snapshot");
  const system = `You run a fast, low-cost preliminary scan of a company for a paid due-diligence report.
Use at most ${QUICK_MAX_SEARCHES} web searches. Find the official website and enough to write a short snapshot, and estimate how many distinct useful sources exist for each later report section.

${RULES}

Return exactly this JSON shape:
{
  "website": string | null,
  "snapshot": ${SECTION_SHAPE},
  "sourceCounts": { ${others.map((k) => `"${k}": number`).join(", ")} },
  "sources": [${SOURCE_SHAPE}]
}
The snapshot is 2-5 items: what the company does, where it operates, size or scale signals, and anything notable. sourceCounts is the number of distinct relevant sources you saw for each section (0 if none).`;

  const { data, seenUrls } = await runResearchAgent({
    model: QUICK_MODEL,
    system,
    prompt: describeTarget(target),
    tools,
    maxTokens: 6000,
    effort: "low",
    schema: ModelPreviewSchema,
    maxContinuations: 1,
    onEvent,
    usage,
  });
  const grounded = groundSections({ snapshot: data.snapshot }, data.sources, seenUrls);
  return {
    website: data.website,
    snapshot: grounded.sections.snapshot as Section,
    sourceCounts: data.sourceCounts as ModelPreview["sourceCounts"],
    sources: grounded.sources,
  };
}

// ---------- Deep research (paid) ----------

export async function deepResearch(
  target: Target,
  onEvent: (e: ProgressEvent<never>) => void,
  usage?: UsageTracker,
): Promise<Report> {
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    { type: "web_search_20260209", name: "web_search", max_uses: DEEP_MAX_SEARCHES, blocked_domains: BLOCKED_DOMAINS },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: DEEP_MAX_FETCHES, blocked_domains: BLOCKED_DOMAINS, max_content_tokens: 20000 },
  ];
  const system = `You are a careful company research analyst preparing a cited intelligence report for a paying customer.
Use up to ${DEEP_MAX_SEARCHES} web searches and ${DEEP_MAX_FETCHES} page fetches. Start from the official website, then news, industry and public directory sources. Prefer primary and reputable sources.

${RULES}

Sections to fill:
- snapshot: what the company does, scale, locations, key facts from its website.
- corporateStructure: officers and founders (names and roles only), parent company and subsidiaries if publicly reported.
- productsAndServices: main offerings, target customers, pricing model if public.
- marketingStrategy: positioning, channels, messaging, recent campaigns.
- marketAndCompetitors: the market it operates in and named competitors.
- newsAndReputation: notable recent news, awards, reviews, controversies.
- riskFlags: struck off or inactive status signals, adverse media, litigation, regulatory actions, inconsistencies between sources.

"confidence" reflects how well-sourced and consistent each section is.

Return exactly this JSON shape:
{
${SECTION_KEYS.map((k) => `  "${k}": ${SECTION_SHAPE},`).join("\n")}
  "sources": [${SOURCE_SHAPE}]
}`;

  const { data, seenUrls } = await runResearchAgent({
    model: DEEP_MODEL,
    system,
    prompt: describeTarget(target),
    tools,
    maxTokens: 32000,
    effort: "medium",
    schema: ModelReportSchema,
    serverFallback: true,
    onEvent,
    usage,
  });

  const sections = Object.fromEntries(SECTION_KEYS.map((k) => [k, data[k]])) as Record<SectionKey, Section>;
  const grounded = groundSections(sections, data.sources, seenUrls);
  return {
    companyName: target.registry?.entityName ?? target.companyName,
    uen: target.uen,
    website: target.website,
    generatedAt: new Date().toISOString(),
    registry: target.registry,
    sections: grounded.sections,
    sources: grounded.sources,
  };
}

export function previewSections(sourceCounts: ModelPreview["sourceCounts"]) {
  return SECTION_KEYS.filter((k) => k !== "snapshot").map((k) => ({
    key: k,
    title: SECTION_TITLES[k],
    sourceCount: sourceCounts[k as keyof typeof sourceCounts] ?? 0,
  }));
}
