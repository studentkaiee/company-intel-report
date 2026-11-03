"use client";

import { useCallback, useState } from "react";
import { Checkout } from "./checkout";
import { ProgressLog, logLineFor, type LogLine } from "./progress-log";
import { RegistryView, SectionView, SourceList } from "./section-view";
import { Turnstile } from "./turnstile";
import { DISCLAIMER } from "@/lib/legal";
import { readNdjson } from "@/lib/ndjson";
import { formatSgd } from "@/lib/price";
import { SECTION_TITLES, type Preview, type RegistryFacts } from "@/lib/report-schema";

type Candidate = { name: string; uen: string | null; registry: RegistryFacts | null; ticket: string };

type Step =
  | { kind: "search" }
  | { kind: "candidates"; candidates: Candidate[]; webTicket: string | null; query: string }
  | { kind: "scanning"; candidate: Candidate; log: LogLine[] }
  | { kind: "preview"; preview: Preview }
  | { kind: "pay"; preview: Preview };

export function ResearchFlow() {
  const [step, setStep] = useState<Step>({ kind: "search" });
  const [query, setQuery] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onToken = useCallback((t: string | null) => setTurnstileToken(t), []);

  async function resolve(mode: "acra" | "web") {
    if (!turnstileToken) return setError("Please complete the bot check.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, mode, turnstileToken }),
      });
      const json = (await res.json()) as { candidates?: Candidate[]; webTicket?: string; error?: string };
      if (!res.ok || !json.candidates) throw new Error(json.error ?? "Search failed.");
      if (mode === "web" && json.candidates[0]) return void scan(json.candidates[0]);
      setStep({ kind: "candidates", candidates: json.candidates, webTicket: json.webTicket ?? null, query });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      // Turnstile tokens are single-use.
      setTurnstileToken(null);
      setTurnstileReset((n) => n + 1);
      setBusy(false);
    }
  }

  async function scan(candidate: Candidate) {
    setError(null);
    let log: LogLine[] = [];
    setStep({ kind: "scanning", candidate, log });
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket: candidate.ticket }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Scan failed.");
      }
      let preview: Preview | null = null;
      await readNdjson<Preview>(res, (e) => {
        if (e.type === "done") preview = e.data;
        else if (e.type === "error") throw new Error(e.message);
        else {
          const line = logLineFor(e);
          if (line) {
            log = [...log, line];
            setStep({ kind: "scanning", candidate, log });
          }
        }
      });
      if (!preview) throw new Error("Scan did not complete.");
      setStep({ kind: "preview", preview });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed.");
      setStep({ kind: "search" });
    }
  }

  return (
    <div className="space-y-6">
      {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {step.kind === "search" ? (
        <form
          className="space-y-3 rounded-lg border border-line bg-white p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void resolve("acra");
          }}
        >
          <label htmlFor="q" className="block text-sm font-medium">
            Company name
          </label>
          <input
            id="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Acme Trading Pte. Ltd."
            className="w-full rounded-md border border-line px-3 py-2 outline-none focus:border-accent"
            minLength={2}
            maxLength={120}
            required
            autoComplete="off"
          />
          <Turnstile onToken={onToken} resetKey={turnstileReset} />
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={busy || !turnstileToken || query.trim().length < 2}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Searching…" : "Search Singapore registry"}
            </button>
            <button
              type="button"
              disabled={busy || !turnstileToken || query.trim().length < 2}
              onClick={() => void resolve("web")}
              className="rounded-md border border-line px-4 py-2 text-sm disabled:opacity-50"
            >
              Not a Singapore company? Search the web
            </button>
          </div>
        </form>
      ) : null}

      {step.kind === "candidates" ? (
        <div className="space-y-3">
          <h2 className="font-semibold">Which company did you mean?</h2>
          {step.candidates.length === 0 ? (
            <p className="text-sm text-muted">No match in the ACRA registry for “{step.query}”.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-white">
              {step.candidates.map((c) => (
                <li key={c.ticket}>
                  <button onClick={() => void scan(c)} className="w-full px-4 py-3 text-left hover:bg-accent-soft">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted">
                      {c.uen} · {c.registry?.entityType} · {c.registry?.status}
                      {c.registry?.address ? ` · ${c.registry.address}` : ""}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-3 text-sm">
            {step.webTicket ? (
              <button
                className="text-accent hover:underline"
                onClick={() => void scan({ name: step.query, uen: null, registry: null, ticket: step.webTicket! })}
              >
                Not listed? Search the web for “{step.query}” instead
              </button>
            ) : null}
            <button className="text-muted hover:underline" onClick={() => setStep({ kind: "search" })}>
              New search
            </button>
          </div>
        </div>
      ) : null}

      {step.kind === "scanning" ? (
        <div className="space-y-3">
          <h2 className="font-semibold">Quick scan: {step.candidate.name}</h2>
          <ProgressLog lines={step.log} active />
        </div>
      ) : null}

      {step.kind === "preview" || step.kind === "pay" ? <PreviewView preview={step.preview} /> : null}

      {step.kind === "preview" ? (
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setStep({ kind: "pay", preview: step.preview })}
            className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white"
          >
            Get the full report (PDF) — {formatSgd(step.preview.priceSgdCents)}
          </button>
          <button className="text-sm text-muted hover:underline" onClick={() => setStep({ kind: "search" })}>
            Start over
          </button>
        </div>
      ) : null}

      {step.kind === "pay" ? <Checkout previewToken={step.preview.previewToken} /> : null}
    </div>
  );
}

function PreviewView({ preview }: { preview: Preview }) {
  return (
    <article className="space-y-6 rounded-lg border border-line bg-white p-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-muted">Free preview</p>
        <h2 className="text-2xl font-semibold">{preview.companyName}</h2>
        {preview.website ? (
          <a href={preview.website} target="_blank" rel="noopener noreferrer nofollow" className="text-sm text-accent hover:underline">
            {preview.website}
          </a>
        ) : null}
      </header>

      <section className="space-y-2">
        <h3 className="text-lg font-semibold">Registry facts</h3>
        <RegistryView registry={preview.registry} />
      </section>

      <SectionView title={SECTION_TITLES.snapshot} section={preview.snapshot} sources={preview.sources} />

      <div className="space-y-4">
        {preview.sections.map((s) => (
          <section key={s.key} className="relative overflow-hidden rounded-md border border-line p-4">
            <div className="flex items-baseline justify-between">
              <h3 className="font-semibold">{s.title}</h3>
              <span className="text-xs text-muted">
                {s.sourceCount > 0 ? `${s.sourceCount} source${s.sourceCount === 1 ? "" : "s"} found` : "to be researched"}
              </span>
            </div>
            <div aria-hidden className="mt-2 select-none space-y-1.5 blur-sm">
              <div className="h-3 w-11/12 rounded bg-zinc-200" />
              <div className="h-3 w-9/12 rounded bg-zinc-200" />
              <div className="h-3 w-10/12 rounded bg-zinc-200" />
            </div>
          </section>
        ))}
      </div>

      {preview.sources.length ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Preview sources</h3>
          <SourceList sources={preview.sources} />
        </section>
      ) : null}

      <p className="rounded-md bg-zinc-50 p-3 text-xs text-muted">{DISCLAIMER}</p>
    </article>
  );
}
