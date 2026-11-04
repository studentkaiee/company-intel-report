import { FindingCard } from "./finding-card";
import { CATEGORIES, type Category } from "@/lib/person/schema";
import type { Litigation } from "@/lib/report-schema";
import { COMPANY_HISTORICAL_NOTE } from "@/lib/legal";

const CATEGORY_ORDER: Category[] = ["court_judgment", "regulatory_action", "investor_alert", "local_media", "other"];

/** The company report's litigation, court history and sanctions section. */
export function LitigationView({ litigation }: { litigation: Litigation }) {
  const strong = litigation.findings.filter((f) => f.matchConfidence === "strong").length;
  const hit = litigation.sanctions.status === "possible_match";
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Litigation and court records</h2>

      <div className="grid grid-cols-3 gap-3 rounded-lg border border-line bg-white p-4 text-center">
        <Stat value={litigation.findings.length} label="Records found" />
        <Stat value={strong} label="Strong matches" />
        <Stat value={hit ? "Possible match" : "No match"} label="Sanctions lists" alert={hit} />
      </div>
      {litigation.overallNote ? <p className="text-sm">{litigation.overallNote}</p> : null}

      {litigation.findings.length === 0 ? (
        <p className="text-sm text-muted">No court cases or regulatory actions naming this company were found in the sources searched.</p>
      ) : (
        CATEGORY_ORDER.map((cat) => {
          const items = litigation.findings.filter((f) => f.category === cat);
          return items.length ? (
            <div key={cat} className="space-y-3">
              <h3 className="font-semibold">{CATEGORIES[cat]}</h3>
              {items.map((f) => (
                <FindingCard key={f.sourceUrl} f={f} historicalNote={COMPANY_HISTORICAL_NOTE} />
              ))}
            </div>
          ) : null;
        })
      )}

      {litigation.unlikelyMatches.length || litigation.unlikelyOmitted ? (
        <div className="space-y-3">
          <h3 className="font-semibold">Unlikely matches, shown for transparency</h3>
          {litigation.unlikelyOmitted ? (
            <p className="text-sm text-muted">{litigation.unlikelyOmitted} weak name-only matches were left out because they most likely concern other companies.</p>
          ) : (
            litigation.unlikelyMatches.map((f) => <FindingCard key={f.sourceUrl} f={f} historicalNote={COMPANY_HISTORICAL_NOTE} />)
          )}
        </div>
      ) : null}

      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Sanctions screening</h3>
        <ul className="space-y-1 text-sm">
          {litigation.sanctions.lists.map((l) => (
            <li key={l.list}>
              {l.name}: {!l.checked ? "not checked" : l.matches.length ? `${l.matches.length} possible match(es)` : "no match"}
              {l.checked ? <span className="text-xs text-muted"> (as of {l.asOf})</span> : null}
              {l.matches.map((m) => (
                <div key={m.entryId} className="ml-4 text-xs">
                  {m.listedName} ({m.entryId}): {m.reason}
                </div>
              ))}
            </li>
          ))}
        </ul>
      </div>

      <details className="text-xs text-muted">
        <summary className="cursor-pointer">What was searched ({litigation.searchesRun.length} searches)</summary>
        <ul className="mt-1 list-disc pl-5">
          {litigation.searchesRun.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function Stat({ value, label, alert }: { value: number | string; label: string; alert?: boolean }) {
  return (
    <div>
      <div className={`text-xl font-semibold ${alert ? "text-red-700" : ""}`}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
