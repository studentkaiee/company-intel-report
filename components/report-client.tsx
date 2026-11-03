"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProgressLog, logLineFor, type LogLine } from "./progress-log";
import { RegistryView, SectionView, SourceList } from "./section-view";
import { DISCLAIMER } from "@/lib/legal";
import { readNdjson } from "@/lib/ndjson";
import { reportFilename } from "@/lib/pdf/filename";
import { SECTION_KEYS, SECTION_TITLES, type Report, type ReportPayload } from "@/lib/report-schema";

// The finished report lives only in this browser (no database). Key by Checkout Session.
const storageKey = (sessionId: string) => `report:${sessionId}`;

function loadSaved(sessionId: string): ReportPayload | null {
  try {
    const raw = localStorage.getItem(storageKey(sessionId));
    return raw ? (JSON.parse(raw) as ReportPayload) : null;
  } catch {
    return null;
  }
}

function save(sessionId: string, payload: ReportPayload) {
  try {
    localStorage.setItem(storageKey(sessionId), JSON.stringify(payload));
  } catch {
    // Storage full or blocked: the report is still on screen and downloadable.
  }
}

type State =
  | { kind: "idle" }
  | { kind: "running"; log: LogLine[] }
  | { kind: "ready"; payload: ReportPayload; report: Report }
  | { kind: "error"; message: string; canRetry: boolean };

export function ReportClient() {
  const sessionId = useSearchParams().get("session_id") ?? "";
  const [state, setState] = useState<State>({ kind: "idle" });
  const [downloading, setDownloading] = useState(false);
  const started = useRef(false);

  const run = useCallback(async () => {
    let log: LogLine[] = [];
    setState({ kind: "running", log });
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setState({ kind: "error", message: json.error ?? "Could not start the report.", canRetry: res.status === 409 });
        return;
      }
      let payload: ReportPayload | null = null;
      let failure: { message: string; final: boolean } | null = null;
      await readNdjson<ReportPayload>(res, (e) => {
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
      if (f) {
        setState({ kind: "error", message: f.message, canRetry: !f.final });
        return;
      }
      if (!payload) throw new Error("The report did not complete.");
      const p: ReportPayload = payload;
      save(sessionId, p);
      setState({ kind: "ready", payload: p, report: JSON.parse(p.reportJson) as Report });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "The report failed.", canRetry: true });
    }
  }, [sessionId]);

  useEffect(() => {
    if (started.current || !sessionId) return;
    started.current = true;
    const saved = loadSaved(sessionId);
    if (saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring from browser storage on mount
      setState({ kind: "ready", payload: saved, report: JSON.parse(saved.reportJson) as Report });
    } else {
      void run();
    }
  }, [sessionId, run]);

  async function downloadPdf(payload: ReportPayload, report: Report) {
    setDownloading(true);
    try {
      const res = await fetch("/api/pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, reportJson: payload.reportJson, signature: payload.signature }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "PDF failed.");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = reportFilename(report.companyName);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "PDF failed.");
    } finally {
      setDownloading(false);
    }
  }

  if (!sessionId) return <p className="text-sm text-muted">Missing checkout session. Start from the home page.</p>;

  if (state.kind === "idle" || state.kind === "running") {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Preparing your report</h1>
        <p className="text-sm text-muted">Keep this tab open. Research usually takes a few minutes.</p>
        <ProgressLog lines={state.kind === "running" ? state.log : []} active />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">We couldn&apos;t finish your report</h1>
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{state.message}</p>
        {state.canRetry ? (
          <button onClick={() => void run()} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">
            Try again
          </button>
        ) : (
          <Link href="/" className="inline-block rounded-md border border-line bg-white px-4 py-2 text-sm font-medium">
            Back to search
          </Link>
        )}
        <p className="text-xs text-muted">
          Each purchase includes up to 3 report runs. If all 3 fail, your payment is refunded automatically.
        </p>
      </div>
    );
  }

  const { report, payload } = state;
  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted">Company intelligence report</p>
        <h1 className="text-3xl font-semibold">{report.companyName}</h1>
        <p className="text-sm text-muted">
          {report.uen ? `UEN ${report.uen} · ` : ""}Generated {new Date(report.generatedAt).toLocaleString("en-SG")}
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            onClick={() => void downloadPdf(payload, report)}
            disabled={downloading}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {downloading ? "Preparing PDF…" : "Download PDF"}
          </button>
          <Link href="/" className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-accent-soft">
            Search another company
          </Link>
        </div>
        <p className="text-xs text-muted">
          {payload.emailedTo
            ? `A copy of the PDF has been emailed to ${payload.emailedTo}. This page is saved in this browser only.`
            : "Saved in this browser only. Download the PDF to keep a copy."}
        </p>
      </header>

      <p className="rounded-md bg-zinc-50 p-3 text-xs text-muted">{DISCLAIMER}</p>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Registry facts</h2>
        <RegistryView registry={report.registry} />
      </section>

      {SECTION_KEYS.map((k) => (
        <SectionView key={k} title={SECTION_TITLES[k]} section={report.sections[k]} sources={report.sources} />
      ))}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Sources</h2>
        <SourceList sources={report.sources} />
      </section>
    </article>
  );
}
