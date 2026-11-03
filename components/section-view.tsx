import type { RegistryFacts, Section, Source } from "@/lib/report-schema";
import { REGISTRY_NOTE } from "@/lib/legal";

const CONFIDENCE_STYLE = {
  high: "bg-emerald-50 text-emerald-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-zinc-100 text-zinc-600",
} as const;

export function SectionView({ title, section, sources }: { title: string; section: Section; sources: Source[] }) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold">{title}</h3>
        <span className={`rounded px-1.5 py-0.5 text-xs ${CONFIDENCE_STYLE[section.confidence]}`}>
          {section.confidence} confidence
        </span>
      </div>
      {section.items.length === 0 ? (
        <p className="text-sm italic text-muted">{section.note}</p>
      ) : (
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
          {section.items.map((item, i) => (
            <li key={i}>
              {item.text}{" "}
              {item.sourceIds.map((id) => {
                const src = byId.get(id);
                return src ? (
                  <a
                    key={id}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    title={src.title}
                    className="ml-0.5 align-super text-[10px] text-accent hover:underline"
                  >
                    [{id}]
                  </a>
                ) : null;
              })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RegistryView({ registry }: { registry: RegistryFacts | null }) {
  if (!registry) {
    return <p className="text-sm text-muted">Not matched in the Singapore ACRA registry.</p>;
  }
  const rows: [string, string][] = [
    ["Registered name", registry.entityName],
    ["UEN", registry.uen],
    ["Status", registry.status],
    ["Entity type", registry.entityType],
    ["Registration date", registry.registrationDate],
    ["Registered address", registry.address],
  ];
  return (
    <div>
      <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd>{v || "—"}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted">{REGISTRY_NOTE}</p>
    </div>
  );
}

export function SourceList({ sources }: { sources: Source[] }) {
  return (
    <ol className="space-y-1 text-xs text-muted">
      {sources.map((s) => (
        <li key={s.id}>
          [{s.id}]{" "}
          <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline">
            {s.title}
          </a>{" "}
          · retrieved {s.retrievedAt}
        </li>
      ))}
    </ol>
  );
}
