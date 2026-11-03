"use client";

import { useState } from "react";

const input = "w-full rounded-md border border-line px-3 py-2 outline-none focus:border-accent";

export function VerifyForm() {
  const [f, setF] = useState({ reportId: "", fullName: "", dob: "", strong: "0", possible: "0", sanctions: "no_match", code: "" });
  const [result, setResult] = useState<"valid" | "invalid" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setResult(null);
  };

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/verify-person", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...f, strong: Number(f.strong), possible: Number(f.possible) }),
      });
      const json = (await res.json()) as { valid?: boolean; error?: string };
      if (!res.ok || json.valid === undefined) throw new Error(json.error ?? "Could not check this code.");
      setResult(json.valid ? "valid" : "invalid");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check this code.");
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={k} className="block text-sm font-medium">
        {label}
      </label>
      <input id={k} className={input} value={f[k]} onChange={(e) => set(k, e.target.value)} autoComplete="off" {...props} />
    </div>
  );

  return (
    <form
      className="space-y-4 rounded-lg border border-line bg-white p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {field("reportId", "Report ID", { placeholder: "ILS-1A2B3C4D5E" })}
      {field("fullName", "Subject's full name (as on the cover)")}
      {field("dob", "Date of birth (leave blank if the report says Not given)", { type: "date" })}
      <div className="grid gap-4 sm:grid-cols-3">
        {field("strong", "Strong-match findings", { type: "number", min: 0 })}
        {field("possible", "Possible-match findings", { type: "number", min: 0 })}
        <div>
          <label htmlFor="sanctions" className="block text-sm font-medium">
            Sanctions result
          </label>
          <select id="sanctions" className={input} value={f.sanctions} onChange={(e) => set("sanctions", e.target.value)}>
            <option value="no_match">No match</option>
            <option value="possible_match">Possible match</option>
          </select>
        </div>
      </div>
      {field("code", "Verification code", { placeholder: "XXXX-XXXX-XXXX-XXXX-XXXX" })}
      <button type="submit" disabled={busy} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {busy ? "Checking…" : "Check"}
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {result === "valid" ? (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Genuine: these details match a report we issued.
        </p>
      ) : null}
      {result === "invalid" ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Not verified: the code doesn&apos;t match these details. Check for typos; if they&apos;re correct, the PDF may have been altered.
        </p>
      ) : null}
    </form>
  );
}
