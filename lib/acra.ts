import { z } from "zod";
import type { RegistryFacts } from "./report-schema";

export const ACRA_RESOURCE_ID = "d_3f960c10fed6145404ca7b821f263b87";
const ENDPOINT = "https://data.gov.sg/api/action/datastore_search";
const SOURCE_LABEL = "ACRA via data.gov.sg (Entities Registered with ACRA)";

const RecordSchema = z.object({
  uen: z.string(),
  entity_name: z.string(),
  uen_status_desc: z.string().optional().default(""),
  entity_type_desc: z.string().optional().default(""),
  uen_issue_date: z.string().optional().default(""),
  reg_street_name: z.string().nullable().optional().default(""),
  reg_postal_code: z.string().nullable().optional().default(""),
  issuance_agency_desc: z.string().optional().default("ACRA"),
});

const ResponseSchema = z.object({
  success: z.literal(true),
  result: z.object({ records: z.array(z.unknown()) }),
});

export const UenSchema = z.string().trim().toUpperCase().regex(/^[0-9A-Z]{9,10}$/, "invalid UEN");

export function parseAcraResponse(json: unknown): RegistryFacts[] {
  const parsed = ResponseSchema.safeParse(json);
  if (!parsed.success) throw new Error("Unexpected response from the ACRA registry");
  const out: RegistryFacts[] = [];
  const seen = new Set<string>();
  for (const raw of parsed.data.result.records) {
    const r = RecordSchema.safeParse(raw);
    if (!r.success || seen.has(r.data.uen)) continue;
    seen.add(r.data.uen);
    out.push(toFacts(r.data));
  }
  return out;
}

function toFacts(r: z.infer<typeof RecordSchema>): RegistryFacts {
  const street = (r.reg_street_name ?? "").trim();
  const postal = (r.reg_postal_code ?? "").trim();
  const address = [street, postal ? `Singapore ${postal}` : ""].filter(Boolean).join(", ");
  return {
    uen: r.uen.trim(),
    entityName: r.entity_name.trim(),
    status: r.uen_status_desc.trim(),
    entityType: r.entity_type_desc.trim(),
    registrationDate: r.uen_issue_date.trim(),
    address,
    issuanceAgency: r.issuance_agency_desc.trim(),
    source: SOURCE_LABEL,
  };
}

/** Live entities first, then by closeness of the name to the query. */
export function rankCandidates(query: string, facts: RegistryFacts[]): RegistryFacts[] {
  const q = query.trim().toUpperCase();
  const score = (f: RegistryFacts) => {
    const name = f.entityName.toUpperCase();
    let s = 0;
    if (name === q) s += 100;
    else if (name.startsWith(q)) s += 50;
    else if (name.includes(q)) s += 20;
    if (/^(live|registered)/i.test(f.status)) s += 10;
    return s;
  };
  return [...facts].sort((a, b) => score(b) - score(a));
}

async function query(params: Record<string, string>, fetchImpl: typeof fetch): Promise<RegistryFacts[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("resource_id", ACRA_RESOURCE_ID);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // data.gov.sg occasionally stalls or rate-limits; retry once.
  for (let attempt = 1; ; attempt++) {
    try {
      // The datastore often takes 5-13s on full-register queries.
      const res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`ACRA registry returned HTTP ${res.status}`);
      return parseAcraResponse(await res.json());
    } catch (err) {
      if (attempt >= 2) throw err;
    }
  }
}

const LEGAL_SUFFIX = /\b(pte\.?\s*ltd\.?|private\s+limited|sdn\.?\s*bhd\.?|limited|ltd\.?|llp|inc\.?|corp\.?|co\.?)\s*$/i;

/** Strips punctuation and trailing legal suffixes ("Pte. Ltd.") that make the registry's AND match miss. */
export function cleanNameQuery(name: string): string {
  let q = name.replace(/[^\p{L}\p{N}&\s.-]/gu, " ").replace(/\s+/g, " ").trim();
  for (let prev = ""; prev !== q; ) {
    prev = q;
    q = q.replace(LEGAL_SUFFIX, "").replace(/[\s.,-]+$/, "").trim();
  }
  return q || name.trim();
}

export async function searchAcra(name: string, fetchImpl: typeof fetch = fetch): Promise<RegistryFacts[]> {
  const cleaned = cleanNameQuery(name);
  // A field-scoped query matches all words in the entity name; plain `q` ORs words across every column.
  const results = await query({ q: JSON.stringify({ entity_name: cleaned }), limit: "50" }, fetchImpl);
  return rankCandidates(cleaned, results).slice(0, 10);
}

export async function lookupUen(uen: string, fetchImpl: typeof fetch = fetch): Promise<RegistryFacts | null> {
  const clean = UenSchema.parse(uen);
  const results = await query({ filters: JSON.stringify({ uen: clean }), limit: "1" }, fetchImpl);
  return results[0] ?? null;
}
