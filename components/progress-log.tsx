export type LogLine = { kind: "status" | "search" | "fetch"; text: string };

export function ProgressLog({ lines, active }: { lines: LogLine[]; active: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4 text-sm" aria-live="polite">
      <ul className="space-y-1">
        {lines.map((l, i) => (
          <li key={i} className={l.kind === "status" ? "font-medium" : "pl-4 text-muted"}>
            {l.kind === "search" ? `Searching: “${l.text}”` : l.kind === "fetch" ? `Reading: ${l.text}` : l.text}
          </li>
        ))}
      </ul>
      {active ? <div className="mt-3 h-1 w-full animate-pulse rounded bg-accent-soft" /> : null}
    </div>
  );
}

export function logLineFor(e: { type: string; message?: string; query?: string; url?: string }): LogLine | null {
  if (e.type === "status" && e.message) return { kind: "status", text: e.message };
  if (e.type === "search" && e.query) return { kind: "search", text: e.query };
  if (e.type === "fetch" && e.url) return { kind: "fetch", text: e.url };
  return null;
}
