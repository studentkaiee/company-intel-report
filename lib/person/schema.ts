import { z } from "zod";
import { NRIC_MESSAGE, containsNricLike, personNameProblem } from "./pii";

/** Schemas for the Individual Legal Screen. Safe to import in the browser (no Node APIs). */

export const PURPOSES = {
  director_onboarding: "Onboarding a director",
  business_partner: "Business partner due diligence",
  client_onboarding: "Client onboarding",
  other: "Other",
} as const;
export type Purpose = keyof typeof PURPOSES;

const clean = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

/** Free text: trimmed, length-limited, and never an NRIC/FIN. */
const freeText = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform(clean)
    .pipe(z.string().max(max, `Please keep this under ${max} characters.`))
    .refine((v) => !containsNricLike(v), NRIC_MESSAGE);

const personName = freeText(120).superRefine((v, ctx) => {
  const problem = personNameProblem(v);
  if (problem) ctx.addIssue({ code: "custom", message: problem });
});

const optionalText = (max: number) =>
  freeText(max)
    .optional()
    .transform((v) => v || undefined);

function ageOn(dob: string, today: Date): number {
  const [y, m, d] = dob.split("-").map(Number) as [number, number, number];
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)) age--;
  return age;
}

export const PersonInputSchema = z
  .object({
    fullName: personName,
    aliases: z
      .array(personName)
      .max(3, "Up to 3 aliases.")
      .default([]),
    // Optional name in Chinese, Malay (Jawi) or Tamil script. Letters and spaces only.
    nativeName: freeText(60)
      .refine((v) => v === "" || /^[\p{L}\p{M}\s·.'-]+$/u.test(v), "Use letters only for the name in local script.")
      .optional()
      .transform((v) => v || undefined),
    // Everything except the full name is optional. Without a date of birth, sanctions matches can't be ruled out
    // by age and the research has less to tell namesakes apart.
    dob: z
      .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date of birth as YYYY-MM-DD.")])
      .optional()
      .transform((v) => v || undefined)
      .refine((v) => v === undefined || (!Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v)), "Enter a real date.")
      .refine((v) => {
        if (v === undefined) return true;
        const age = ageOn(v, new Date());
        return age >= 16 && age <= 110;
      }, "Date of birth must be for someone aged 16 to 110."),
    nationality: optionalText(60),
    occupation: optionalText(100),
    company: optionalText(120),
    purpose: z
      .union([z.literal(""), z.enum(Object.keys(PURPOSES) as [Purpose, ...Purpose[]], { message: "Choose a purpose." })])
      .optional()
      .transform((v) => v || undefined),
    consent: z.literal(true, { message: "Please confirm you have consent and a legitimate purpose." }),
  })
  .strict();

export type PersonInput = z.output<typeof PersonInputSchema>;
export type PersonInputRaw = z.input<typeof PersonInputSchema>;

// ---------- Model output (snake_case, as requested from the model) ----------

export const CATEGORIES = {
  court_judgment: "Court judgments",
  regulatory_action: "Regulatory actions",
  investor_alert: "MAS Investor Alert List",
  local_media: "Singapore media reports",
  other: "Other",
} as const;
export type Category = keyof typeof CATEGORIES;

export const CASE_STAGES = {
  allegation: "Allegation",
  investigation: "Under investigation",
  charged: "Charged",
  convicted: "Convicted",
  acquitted: "Acquitted",
  withdrawn: "Charges withdrawn",
  civil_claim: "Civil claim filed",
  settled: "Settled",
  unknown: "Stage unknown",
} as const;
export type CaseStage = keyof typeof CASE_STAGES;

export const MATCH_LEVELS = ["strong", "possible", "weak"] as const;
export type MatchConfidence = (typeof MATCH_LEVELS)[number];

const key = <T extends Record<string, string>>(o: T) => z.enum(Object.keys(o) as [keyof T & string, ...(keyof T & string)[]]);

/**
 * Text the model writes, cut to `max` characters instead of failing validation: a long summary is not a reason to
 * throw away a whole paid run (seen with Hyflux, whose court history is long).
 */
const capped = (max: number, min = 1) =>
  z
    .string()
    .min(min)
    .max(max * 20)
    .transform((v) => (v.length <= max ? v : `${v.slice(0, max - 1).replace(/s+S*$/, "")}…`));

export const ModelFindingSchema = z.object({
  category: key(CATEGORIES),
  case_stage: key(CASE_STAGES).catch("unknown"),
  title: capped(300),
  source_name: capped(200),
  source_url: z.string().url().max(2000),
  additional_source_urls: z.array(z.string().max(2000)).max(10).default([]),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .catch(null),
  summary: capped(800),
  match_confidence: z.enum(MATCH_LEVELS),
  match_evidence: capped(800, 0),
  historical: z.boolean().default(false),
});

export const ModelScreenSchema = z.object({
  searches_run: z.array(capped(300, 0)).max(100).transform((a) => a.slice(0, 60)).default([]),
  findings: z.array(ModelFindingSchema).max(40),
  overall_note: capped(1500, 0).default(""),
});
export type ModelScreen = z.output<typeof ModelScreenSchema>;

// ---------- Final report (returned to the browser, signed) ----------

export const FindingSchema = z.object({
  category: key(CATEGORIES),
  caseStage: key(CASE_STAGES),
  title: z.string(),
  sourceName: z.string(),
  sourceUrl: z.string(),
  additionalSourceUrls: z.array(z.string()),
  date: z.string().nullable(),
  summary: z.string(),
  matchConfidence: z.enum(MATCH_LEVELS),
  matchEvidence: z.string(),
  historical: z.boolean(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const SanctionsMatchSchema = z.object({
  entryId: z.string(),
  listedName: z.string(),
  score: z.number(),
  birthYears: z.array(z.number()),
  nationalities: z.array(z.string()),
  program: z.string(),
  reason: z.string(),
});

export const SanctionsListResultSchema = z.object({
  list: z.string(),
  name: z.string(),
  asOf: z.string(),
  checked: z.boolean(),
  matches: z.array(SanctionsMatchSchema),
});
export type SanctionsListResult = z.infer<typeof SanctionsListResultSchema>;

export const SanctionsResultSchema = z.object({
  status: z.enum(["no_match", "possible_match"]),
  lists: z.array(SanctionsListResultSchema),
});
export type SanctionsResult = z.infer<typeof SanctionsResultSchema>;

export const PersonReportSchema = z.object({
  reportId: z.string(),
  generatedAt: z.string(),
  subject: z.object({
    fullName: z.string(),
    aliases: z.array(z.string()),
    nativeName: z.string().nullable(),
    dob: z.string().nullable(),
    nationality: z.string().nullable(),
    occupation: z.string().nullable(),
    company: z.string().nullable(),
  }),
  purpose: z.string(),
  sanctions: SanctionsResultSchema,
  findings: z.array(FindingSchema),
  unlikelyMatches: z.array(FindingSchema),
  /** Weak findings left out entirely because there were more than 3. */
  unlikelyOmitted: z.number(),
  searchesRun: z.array(z.string()),
  overallNote: z.string(),
  verificationCode: z.string(),
});
export type PersonReport = z.infer<typeof PersonReportSchema>;

export type PersonReportPayload = { report: PersonReport; signature: string };

export function findingCounts(report: Pick<PersonReport, "findings">) {
  return {
    strong: report.findings.filter((f) => f.matchConfidence === "strong").length,
    possible: report.findings.filter((f) => f.matchConfidence === "possible").length,
  };
}

/** The fields a verification code covers. A verifier types these in from the PDF. */
export function verificationFields(r: {
  reportId: string;
  fullName: string;
  /** "" when no date of birth was given. */
  dob: string;
  strong: number;
  possible: number;
  sanctions: SanctionsResult["status"];
}) {
  return {
    reportId: r.reportId.trim().toUpperCase(),
    fullName: r.fullName.normalize("NFC").replace(/\s+/g, " ").trim().toUpperCase(),
    dob: r.dob,
    strong: r.strong,
    possible: r.possible,
    sanctions: r.sanctions,
  };
}
