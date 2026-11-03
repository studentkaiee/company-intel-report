"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { EmbeddedCheckoutBox } from "./checkout";
import { Turnstile } from "./turnstile";
import { saveInputs } from "@/lib/person/browser-storage";
import { NOT_A_CRIMINAL_RECORD_CHECK } from "@/lib/person/legal";
import { PURPOSES, PersonInputSchema, type PersonInputRaw, type Purpose } from "@/lib/person/schema";
import { formatSgd } from "@/lib/price";

type Fields = {
  fullName: string;
  aliases: [string, string, string];
  nativeName: string;
  dob: string;
  nationality: string;
  occupation: string;
  company: string;
  purpose: Purpose | "";
  consent: boolean;
};

const EMPTY: Fields = {
  fullName: "",
  aliases: ["", "", ""],
  nativeName: "",
  dob: "",
  nationality: "",
  occupation: "",
  company: "",
  purpose: "",
  consent: false,
};

const input = "w-full rounded-md border border-line px-3 py-2 outline-none focus:border-accent";

function toRaw(f: Fields): PersonInputRaw {
  return {
    fullName: f.fullName,
    aliases: f.aliases.filter((a) => a.trim()),
    nativeName: f.nativeName || undefined,
    dob: f.dob,
    nationality: f.nationality,
    occupation: f.occupation || undefined,
    company: f.company || undefined,
    purpose: f.purpose,
    consent: f.consent as true,
  };
}

export function PersonForm({ priceSgdCents }: { priceSgdCents: number }) {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const onToken = useCallback((t: string | null) => setTurnstileToken(t), []);
  const fetchClientSecret = useCallback(async () => clientSecret ?? "", [clientSecret]);

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setFields((f) => ({ ...f, [k]: v }));

  async function submit() {
    setFormError(null);
    const raw = toRaw(fields);
    const parsed = PersonInputSchema.safeParse(raw);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[issue.path.join(".")] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    if (!turnstileToken) return setFormError("Please complete the bot check.");

    setBusy(true);
    try {
      // Kept in this tab only, so the report page can send the same details after payment.
      saveInputs(raw);
      const res = await fetch("/api/person-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inputs: raw, turnstileToken }),
      });
      const json = (await res.json()) as { clientSecret?: string; error?: string };
      if (!res.ok || !json.clientSecret) throw new Error(json.error ?? "Could not start checkout.");
      setClientSecret(json.clientSecret);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not start checkout.");
    } finally {
      setTurnstileToken(null);
      setTurnstileReset((n) => n + 1);
      setBusy(false);
    }
  }

  if (clientSecret) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Pay in this tab: the details you entered are kept in this tab only and are needed after payment.
        </p>
        <EmbeddedCheckoutBox fetchClientSecret={fetchClientSecret} />
        <button className="text-sm text-muted hover:underline" onClick={() => setClientSecret(null)}>
          Edit details
        </button>
      </div>
    );
  }

  const err = (k: string) => (errors[k] ? <p className="mt-1 text-xs text-red-700">{errors[k]}</p> : null);

  return (
    <form
      className="space-y-5 rounded-lg border border-line bg-white p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        {NOT_A_CRIMINAL_RECORD_CHECK} Do not enter NRIC, FIN or passport numbers anywhere on this form.
      </p>

      {formError ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{formError}</p> : null}

      <div>
        <label htmlFor="fullName" className="block text-sm font-medium">
          Full name
        </label>
        <input id="fullName" className={input} value={fields.fullName} onChange={(e) => set("fullName", e.target.value)} maxLength={120} autoComplete="off" />
        {err("fullName")}
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Known aliases or other spellings (optional, up to 3)</legend>
        <div className="mt-1 grid gap-2 sm:grid-cols-3">
          {fields.aliases.map((a, i) => (
            <div key={i}>
              <input
                aria-label={`Alias ${i + 1}`}
                className={input}
                value={a}
                maxLength={120}
                autoComplete="off"
                onChange={(e) => {
                  const next = [...fields.aliases] as Fields["aliases"];
                  next[i] = e.target.value;
                  set("aliases", next);
                }}
              />
            </div>
          ))}
        </div>
        {err("aliases.0") ?? err("aliases.1") ?? err("aliases.2") ?? err("aliases")}
      </fieldset>

      <div>
        <label htmlFor="nativeName" className="block text-sm font-medium">
          Name in Chinese, Malay or Tamil script (optional)
        </label>
        <input id="nativeName" className={input} value={fields.nativeName} onChange={(e) => set("nativeName", e.target.value)} maxLength={60} autoComplete="off" placeholder="e.g. 陈伟明" />
        <p className="mt-1 text-xs text-muted">Also searched, in case a record uses this form of the name.</p>
        {err("nativeName")}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="dob" className="block text-sm font-medium">
            Date of birth (optional)
          </label>
          <input id="dob" type="date" className={input} value={fields.dob} onChange={(e) => set("dob", e.target.value)} />
          <p className="mt-1 text-xs text-muted">Helps tell people with the same name apart. Only the year is sent to the AI.</p>
          {err("dob")}
        </div>
        <div>
          <label htmlFor="nationality" className="block text-sm font-medium">
            Nationality (optional)
          </label>
          <input id="nationality" list="nationalities" className={input} value={fields.nationality} onChange={(e) => set("nationality", e.target.value)} maxLength={60} autoComplete="off" />
          <datalist id="nationalities">
            {["Singaporean", "Malaysian", "Chinese", "Indian", "Indonesian", "Filipino", "Thai", "Vietnamese", "Australian", "British", "American"].map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          {err("nationality")}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="occupation" className="block text-sm font-medium">
            Occupation (optional)
          </label>
          <input id="occupation" className={input} value={fields.occupation} onChange={(e) => set("occupation", e.target.value)} maxLength={100} autoComplete="off" />
          {err("occupation")}
        </div>
        <div>
          <label htmlFor="company" className="block text-sm font-medium">
            Company they&apos;re associated with (optional)
          </label>
          <input id="company" className={input} value={fields.company} onChange={(e) => set("company", e.target.value)} maxLength={120} autoComplete="off" />
          {err("company")}
        </div>
      </div>

      <div>
        <label htmlFor="purpose" className="block text-sm font-medium">
          Purpose of this check (optional)
        </label>
        <select id="purpose" className={input} value={fields.purpose} onChange={(e) => set("purpose", e.target.value as Purpose)}>
          <option value="">Not stated</option>
          {Object.entries(PURPOSES).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        {err("purpose")}
      </div>

      <div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={fields.consent} onChange={(e) => set("consent", e.target.checked)} />
          <span>I confirm I have this person&apos;s consent to carry out this check and a legitimate purpose for it.</span>
        </label>
        {err("consent")}
      </div>

      <p className="text-xs text-muted">
        Read the{" "}
        <Link href="/person-check/privacy" className="text-accent hover:underline">
          privacy notice
        </Link>{" "}
        for what is collected, what is sent to Anthropic and the search provider, and why nothing is stored.
      </p>

      <Turnstile onToken={onToken} resetKey={turnstileReset} />

      <button type="submit" disabled={busy || !turnstileToken} className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
        {busy ? "Checking details…" : `Continue to payment — ${formatSgd(priceSgdCents)}`}
      </button>
    </form>
  );
}
