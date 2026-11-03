"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProgressLog, logLineFor, type LogLine } from "./progress-log";
import { readNdjson } from "@/lib/ndjson";
import { loadInputs, loadReport, saveReport } from "@/lib/person/browser-storage";
import { HISTORICAL_NOTE, PERSON_LIMITATIONS } from "@/lib/person/legal";
import { CASE_STAGES, CATEGORIES, findingCounts, type Category, type Finding, type PersonReportPayload } from "@/lib/person/schema";

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

type State =
  | { kind: "idle" }
  | { kind: "running"; log: LogLine[] }
  | { kind: "ready"; payload: PersonReportPayload }
  | { kind: "error"; message: string; canRetry: boolean };

const CATEGORY_ORDER: Category[] = ["court_judgment", "regulatory_action", "investor_alert", "local_media", "other"];

export function PersonReportClient() {
  const sessionId = useSearchParams().get("session_id") ?? "";
  const [state, setState] = useState<State>({ kind: "idle" });
  const [downloading, setDownloading] = useState(false);
  const started = useRef(false);

  const run = useCallback(async () => {
    const inputs = loadInputs();
    if (!inputs) {
      setState({
        kind: "error",
        canRetry: false,
        message:
          "The person's details aren't in this browser tab. They are kept only in the tab you paid from, so open this page there.",
      });
      return;
    }
    let log: LogLine[] = [];
    setState({ kind: "running", log });
    try {
      const res = await fetch("/api/person-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, inputs }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setState({ kind: "error", message: json.error ?? "Could not start the screen.", canRetry: res.status === 409 });
        return;
      }
      let payload: PersonReportPayload | null = null;
      let failure: { message: string; final: boolean } | null = null;
      await readNdjson<PersonReportPayload>(res, (e) => {
        if (e.type === "done") payload = e.data;
        else if (e.type === "error") failure = { message: e.message, final: e.final ?? false };
        else {
          const line = logLineFor(e);
          if (line) {
            log = [...log, line];
            setState({ kind: "running", log });
          }
        }
      });
      const f = failure as { message: string; final: boolean } | null;
      if (f) return setState({ kind: "error", message: f.message, canRetry: !f.final });
      if (!payload) throw new Error("The screen did not complete.");
      saveReport(sessionId, payload);
      setState({ kind: "ready", payload });
    } catch {
      setState({ kind: "error", message: "The connection dropped before the screen finished.", canRetry: true });
    }
  }, [sessionId]);

  useEffect(() => {
    if (started.current || !sessionId) return;
    started.current = true;
    const saved = loadReport(sessionId);
    if (saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring from browser storage on mount
      setState({ kind: "ready", payload: saved });
    } else {
      void run();
    }
  }, [sessionId, run]);

  async function downloadPdf(payload: PersonReportPayload) {
    setDownloading(true);
    try {
      const res = await fetch("/api/person-pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "PDF failed.");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${payload.report.reportId}-individual-legal-screen.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "PDF failed.");
    } finally {
      setDownloading(false);
    }
  }

  if (!sessionId) return <p className="text-sm text-muted">Missing checkout session. Start from the Individual Legal Screen page.</p>;

  if (state.kind === "idle" || state.kind === "running") {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Running the screen</h1>
        <p className="text-sm text-muted">Keep this tab open. This usually takes 1-3 minutes.</p>
        <ProgressLog lines={state.kind === "running" ? state.log : []} active />
      </div>
    );
  }

  if (state.kind === "error") {
    const refundHref = SUPPORT_EMAIL
      ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Refund request: Individual Legal Screen")}&body=${encodeURIComponent(`Checkout session: ${sessionId}`)}`
      : null;
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">We couldn&apos;t finish the screen</h1>
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{state.message}</p>
        {state.canRetry ? (
          <button onClick={() => void run()} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">
            Try again
          </button>
        ) : null}
        <p className="text-xs text-muted">
          Session ID: <code className="select-all">{sessionId}</code>. Each purchase includes up to 3 attempts; if all 3 fail,
          your payment is refunded automatically.{" "}
          {refundHref ? (
            <a href={refundHref} className="text-accent hover:underline">
              Request a refund
            </a>
          ) : null}
        </p>
        <Link href="/person-check" className="inline-block text-sm text-muted hover:underline">
          Back to the form
        </Link>
      </div>
    );
  }

  const { report } = state.payload;
  const counts = findingCounts(report);
  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted">Individual Legal Screen</p>
        <h1 className="text-3xl font-semibold">{report.subject.fullName}</h1>
        <p className="text-sm text-muted">
          {report.reportId}
          {report.subject.dob ? ` · Born ${report.subject.dob}` : ""}
          {report.subject.nationality ? ` · ${report.subject.nationality}` : ""} · Generated{" "}
          {new Date(report.generatedAt).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })} SGT
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            onClick={() => void downloadPdf(state.payload)}
            disabled={downloading}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {downloading ? "Preparing PDF…" : "Download PDF"}
          </button>
          <Link href="/person-check" className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-accent-soft">
            Screen another person
          </Link>
        </div>
        <p className="text-xs font-medium text-amber-800">
          This report is kept only in this browser tab and is gone when you close it. Download the PDF to keep a copy.
        </p>
      </header>

      <section className="grid grid-cols-3 gap-3 rounded-lg border border-line bg-white p-4 text-center">
        <Stat value={counts.strong} label="Strong-match findings" />
        <Stat value={counts.possible} label="Possible-match findings" />
        <Stat value={report.sanctions.status === "possible_match" ? "Possible match" : "No match"} label="Sanctions lists" />
      </section>
      {report.overallNote ? <p className="text-sm">{report.overallNote}</p> : null}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Sanctions screening</h2>
        <ul className="space-y-2 text-sm">
          {report.sanctions.lists.map((l) => (
            <li key={l.list} className="rounded-md border border-line bg-white p-3">
              <div className="font-medium">
                {l.name}: {!l.checked ? "not checked" : l.matches.length ? `${l.matches.length} possible match(es)` : "no match"}
              </div>
              <div className="text-xs text-muted">{l.checked ? `List as of ${l.asOf}` : "This list was not loaded."}</div>
              {l.matches.map((m) => (
                <div key={m.entryId} className="mt-1 text-xs">
                  {m.listedName} ({m.entryId}): {m.reason}
                </div>
              ))}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Findings</h2>
        {report.findings.length === 0 ? <p className="text-sm text-muted">No strong or possible matches were found in the sources searched.</p> : null}
        {CATEGORY_ORDER.map((cat) => {
          const items = report.findings.filter((f) => f.category === cat);
          return items.length ? (
            <div key={cat} className="space-y-3">
              <h3 className="font-semibold">{CATEGORIES[cat]}</h3>
              {items.map((f) => (
                <FindingCard key={f.sourceUrl} f={f} />
              ))}
            </div>
          ) : null;
        })}
      </section>

      {report.unlikelyMatches.length || report.unlikelyOmitted ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Unlikely matches, shown for transparency</h2>
          {report.unlikelyOmitted ? (
            <p className="text-sm text-muted">{report.unlikelyOmitted} weak name-only matches were left out because they most likely concern other people.</p>
          ) : (
            report.unlikelyMatches.map((f) => <FindingCard key={f.sourceUrl} f={f} />)
          )}
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">What was searched</h2>
        <ul className="list-disc pl-5 text-xs text-muted">
          {report.searchesRun.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ul>
      </section>

      <section className="space-y-2 rounded-md bg-zinc-50 p-4 text-xs text-muted">
        <h2 className="text-sm font-semibold text-ink">Limitations</h2>
        <ol className="list-decimal space-y-1 pl-5">
          {PERSON_LIMITATIONS.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      </section>
    </article>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function FindingCard({ f }: { f: Finding }) {
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
      {f.historical ? <p className="mt-1 text-xs italic text-muted">{HISTORICAL_NOTE}</p> : null}
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
