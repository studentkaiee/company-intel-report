import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <article className="space-y-4 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Privacy policy</h1>
      <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800">
        Placeholder. This policy has not yet been reviewed by a Singapore-qualified lawyer and must be before launch.
      </p>
      <h2 className="text-lg font-semibold">What we collect</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>The company name you search for and the company you select.</li>
        <li>
          Payment details, collected and stored by Stripe, not by us. We store the company name, UEN, website and a
          report-run counter in Stripe&apos;s payment records.
        </li>
        <li>A bot-protection check by Cloudflare Turnstile.</li>
      </ul>
      <h2 className="text-lg font-semibold">What we don&apos;t do</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>We have no user accounts and no database. Finished reports are kept only in your browser.</li>
        <li>We do not run analytics or advertising scripts on report pages.</li>
        <li>
          Reports name company officers and their roles only. We do not collect home addresses, photos or personal social
          media profiles.
        </li>
      </ul>
      <h2 className="text-lg font-semibold">Processors</h2>
      <p>Stripe (payments), Cloudflare (bot protection), Anthropic (AI research), Vercel (hosting).</p>
      <h2 className="text-lg font-semibold">Contact</h2>
      <p>[Data protection officer contact to be added.]</p>
    </article>
  );
}
