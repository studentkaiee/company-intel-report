import { HISTORICAL_NOTE } from "@/lib/person/legal";
import { CASE_STAGES, type Finding } from "@/lib/person/schema";

/** One legal or regulatory finding with its links. Used by the person screen and the company report. */
/** `historicalNote` replaces the default note for old findings (the spent-conviction wording only fits people). */
export function FindingCard({ f, historicalNote = HISTORICAL_NOTE }: { f: Finding; historicalNote?: string }) {
  const finalOutcome = f.caseStage === "acquitted" || f.caseStage === "withdrawn";
  return (
    <div className="rounded-md border border-line bg-white p-4 text-sm">
      <div className="font-medium">{f.title}</div>
      <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
        <span>{f.date ?? "Date unknown"}</span>
        <span>· {f.sourceName}</span>
        <span className={finalOutcome ? "rounded bg-green-100 px-1.5 font-semibold text-green-800" : "rounded bg-zinc-100 px-1.5 font-medium"}>
          {CASE_STAGES[f.caseStage]}
        </span>
        <span className="rounded bg-accent-soft px-1.5">Match: {f.matchConfidence}</span>
      </div>
      <p className="mt-2">{f.summary}</p>
      <p className="mt-1 text-xs text-muted">Match evidence: {f.matchEvidence}</p>
      {f.historical ? <p className="mt-1 text-xs italic text-muted">{historicalNote}</p> : null}
      <ul className="mt-2 space-y-0.5 text-xs">
        {[f.sourceUrl, ...f.additionalSourceUrls].map((u) => (
          <li key={u}>
            <a href={u} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-accent hover:underline">
              {u}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
