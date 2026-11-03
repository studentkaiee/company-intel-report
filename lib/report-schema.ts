import { z } from "zod";

export const NO_INFO_NOTE = "No public information found";

export const SECTION_KEYS = [
  "snapshot",
  "corporateStructure",
  "productsAndServices",
  "marketingStrategy",
  "marketAndCompetitors",
  "newsAndReputation",
  "riskFlags",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_TITLES: Record<SectionKey, string> = {
  snapshot: "Company snapshot",
  corporateStructure: "Corporate structure",
  productsAndServices: "Products and services",
  marketingStrategy: "Marketing strategy",
  marketAndCompetitors: "Market and competitors",
  newsAndReputation: "News and reputation",
  riskFlags: "Risk flags",
};

export const SourceIdSchema = z.string().regex(/^S\d{1,3}$/, "source ids look like S1, S2, ...");

export const SourceSchema = z.object({
  id: SourceIdSchema,
  title: z.string().min(1).max(300),
  url: z.url({ protocol: /^https?$/ }),
  retrievedAt: z.string().min(1),
});
export type Source = z.infer<typeof SourceSchema>;

export const ItemSchema = z.object({
  text: z.string().min(1).max(1500),
  sourceIds: z.array(SourceIdSchema).min(1, "every item must cite at least one source"),
});
export type Item = z.infer<typeof ItemSchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);

export const SectionSchema = z
  .object({
    items: z.array(ItemSchema).max(25),
    confidence: ConfidenceSchema,
    note: z.string().max(300).optional(),
  })
  .transform((s) => (s.items.length === 0 ? { ...s, note: s.note || NO_INFO_NOTE } : s));
export type Section = z.infer<typeof SectionSchema>;

const sectionsShape = Object.fromEntries(SECTION_KEYS.map((k) => [k, SectionSchema])) as Record<
  SectionKey,
  typeof SectionSchema
>;

/** What the deep-research model must return. Registry facts are NOT part of this. */
export const ModelReportSchema = z
  .object({
    ...sectionsShape,
    sources: z.array(SourceSchema).max(80),
  })
  .superRefine((r, ctx) => {
    const ids = new Set(r.sources.map((s) => s.id));
    if (ids.size !== r.sources.length) {
      ctx.addIssue({ code: "custom", message: "duplicate source ids", path: ["sources"] });
    }
    for (const key of SECTION_KEYS) {
      r[key].items.forEach((item, i) => {
        for (const id of item.sourceIds) {
          if (!ids.has(id)) {
            ctx.addIssue({ code: "custom", message: `unknown source id ${id}`, path: [key, "items", i] });
          }
        }
      });
    }
  });
export type ModelReport = z.infer<typeof ModelReportSchema>;

/** Facts copied verbatim from the ACRA registry. Never produced by the model. */
export const RegistryFactsSchema = z.object({
  uen: z.string(),
  entityName: z.string(),
  status: z.string(),
  entityType: z.string(),
  registrationDate: z.string(),
  address: z.string(),
  issuanceAgency: z.string(),
  source: z.string(),
});
export type RegistryFacts = z.infer<typeof RegistryFactsSchema>;

export const ReportSchema = z.object({
  companyName: z.string(),
  uen: z.string().nullable(),
  website: z.string().nullable(),
  generatedAt: z.string(),
  registry: RegistryFactsSchema.nullable(),
  sections: z.object(sectionsShape),
  sources: z.array(SourceSchema),
});
export type Report = z.infer<typeof ReportSchema>;

/** Final event of /api/report. `reportJson` is signed as-is so the PDF route can trust it. */
export type ReportPayload = {
  reportJson: string;
  signature: string;
  runsLeft: number;
  /** Masked address the PDF was emailed to, or null if it wasn't sent. */
  emailedTo: string | null;
};

/** Quick-scan output from the cheap model. */
export const ModelPreviewSchema = z
  .object({
    website: z.url({ protocol: /^https?$/ }).nullable(),
    snapshot: SectionSchema,
    sourceCounts: z.object(
      Object.fromEntries(SECTION_KEYS.filter((k) => k !== "snapshot").map((k) => [k, z.number().int().min(0).max(50)])) as Record<
        Exclude<SectionKey, "snapshot">,
        z.ZodNumber
      >,
    ),
    sources: z.array(SourceSchema).max(30),
  })
  .superRefine((r, ctx) => {
    const ids = new Set(r.sources.map((s) => s.id));
    r.snapshot.items.forEach((item, i) => {
      for (const id of item.sourceIds) {
        if (!ids.has(id)) ctx.addIssue({ code: "custom", message: `unknown source id ${id}`, path: ["snapshot", "items", i] });
      }
    });
  });
export type ModelPreview = z.infer<typeof ModelPreviewSchema>;

export type Preview = {
  companyName: string;
  uen: string | null;
  website: string | null;
  registry: RegistryFacts | null;
  snapshot: Section;
  sections: { key: SectionKey; title: string; sourceCount: number }[];
  sources: Source[];
  /** Signed token binding uen/name/website, required to start checkout. */
  previewToken: string;
  /** Report price, same value Checkout will charge (REPORT_PRICE_SGD_CENTS). */
  priceSgdCents: number;
};

/**
 * Drops sources whose URL never appeared in the web search/fetch results of this run,
 * then drops item citations to those sources, then drops items left with no citation.
 * This stops the model from citing URLs it invented.
 */
export function groundSections<T extends Partial<Record<SectionKey, Section>>>(
  sections: T,
  sources: Source[],
  seenUrls: Set<string>,
): { sections: T; sources: Source[] } {
  const kept = sources.filter((s) => seenUrls.has(normalizeUrl(s.url)));
  const keptIds = new Set(kept.map((s) => s.id));
  const out = { ...sections };
  for (const key of Object.keys(out) as SectionKey[]) {
    const section = out[key];
    if (!section) continue;
    const items = section.items
      .map((it) => ({ ...it, sourceIds: it.sourceIds.filter((id) => keptIds.has(id)) }))
      .filter((it) => it.sourceIds.length > 0);
    (out as Record<SectionKey, Section>)[key] =
      items.length === 0 ? { items, confidence: "low", note: section.note || NO_INFO_NOTE } : { ...section, items };
  }
  // Only keep sources still cited somewhere.
  const cited = new Set(
    (Object.values(out) as (Section | undefined)[]).flatMap((s) => s?.items.flatMap((i) => i.sourceIds) ?? []),
  );
  return { sections: out, sources: kept.filter((s) => cited.has(s.id)) };
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    let s = `${u.protocol}//${u.host.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`;
    s = s.replace(/^http:/, "https:");
    return s;
  } catch {
    return url;
  }
}
