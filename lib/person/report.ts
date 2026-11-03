import { randomBytes } from "node:crypto";
import { hmacHex, safeEqual, verificationCode } from "./canonical";
import { splitByConfidence } from "./ground";
import type { ScreenResearch } from "./research";
import {
  PURPOSES,
  PersonReportSchema,
  findingCounts,
  verificationFields,
  type PersonInput,
  type PersonReport,
  type PersonReportPayload,
  type SanctionsResult,
} from "./schema";

export function newReportId(): string {
  return `ILS-${randomBytes(5).toString("hex").toUpperCase()}`;
}

/** Assembles the final report, adds its verification code, and signs it. Nothing is stored. */
export function buildPersonReport(
  inputs: PersonInput,
  sanctions: SanctionsResult,
  research: ScreenResearch,
  opts: { reportId?: string; now?: Date; secret?: string } = {},
): PersonReportPayload {
  const reportId = opts.reportId ?? newReportId();
  const split = splitByConfidence(research.findings);
  const counts = findingCounts(split);
  const code = verificationCode(
    verificationFields({ reportId, fullName: inputs.fullName, dob: inputs.dob ?? "", ...counts, sanctions: sanctions.status }),
    opts.secret,
  );
  const report: PersonReport = {
    reportId,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    subject: {
      fullName: inputs.fullName,
      aliases: inputs.aliases,
      nativeName: inputs.nativeName ?? null,
      dob: inputs.dob ?? null,
      nationality: inputs.nationality ?? null,
      occupation: inputs.occupation ?? null,
      company: inputs.company ?? null,
    },
    purpose: inputs.purpose ? PURPOSES[inputs.purpose] : "Not given",
    sanctions,
    ...split,
    searchesRun: research.searchesRun,
    overallNote: research.overallNote,
    verificationCode: code,
  };
  return { report, signature: signReport(report, opts.secret) };
}

export const signReport = (report: PersonReport, secret?: string) => hmacHex("report", report, secret);

/** Checks a report the browser sent back is exactly one this server produced. Returns the parsed report or null. */
export function verifyReportSignature(report: unknown, signature: string, secret?: string): PersonReport | null {
  const parsed = PersonReportSchema.safeParse(report);
  if (!parsed.success) return null;
  return safeEqual(signReport(parsed.data, secret), signature) ? parsed.data : null;
}
