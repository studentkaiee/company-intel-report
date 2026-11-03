import type { Metadata } from "next";

export const metadata: Metadata = { title: "Individual Legal Screen: privacy notice" };

export default function PersonPrivacyPage() {
  return (
    <article className="space-y-4 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Individual Legal Screen: privacy notice</h1>
      <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800">
        Placeholder. This notice has not yet been reviewed by a Singapore-qualified lawyer and must be before launch.
      </p>

      <h2 className="text-lg font-semibold">What you give us</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>The person&apos;s full name, up to 3 aliases, and optionally their name in Chinese, Malay or Tamil script.</li>
        <li>Their date of birth and nationality.</li>
        <li>Optionally, their occupation and a company they&apos;re associated with.</li>
        <li>The purpose of the check, and your confirmation that you have their consent and a legitimate purpose.</li>
      </ul>
      <p>We never ask for NRIC, FIN or passport numbers, and the form rejects anything that looks like one.</p>

      <h2 className="text-lg font-semibold">Where it goes</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Anthropic</strong> (the Claude AI service) receives the name, aliases, name in local script, year of birth
          (not the full date), nationality, occupation and company, so it can run the web searches. Anthropic&apos;s web search
          provider receives the search queries Claude writes, which include the name.
        </li>
        <li>
          <strong>Our server</strong> uses the full date of birth and nationality to compare the person against copies of the UN
          and US OFAC sanctions lists held in the app. This happens in memory and nothing is saved.
        </li>
        <li>
          <strong>Stripe</strong> handles your payment. Stripe receives only a one-way code (a keyed hash) of the details, used
          to confirm the report matches what was paid for. No name, date of birth or other personal details go to Stripe.
        </li>
        <li>
          <strong>Cloudflare Turnstile</strong> runs a bot check on the form.
        </li>
      </ul>

      <h2 className="text-lg font-semibold">What we keep</h2>
      <p>
        Nothing. We have no database and no accounts. The details and the finished report are kept only in your browser
        tab&apos;s session storage and are deleted when you close the tab. Our server logs record counts only (for example, how
        many searches ran and how many findings were found), never names, inputs or results.
      </p>

      <h2 className="text-lg font-semibold">What the report covers</h2>
      <p>
        Only legal and regulatory matters published on Singapore court and regulator websites and other public legal
        sources, plus sanctions lists. Singapore news media are not searched. We do not collect
        or report home addresses, family members, phone numbers, photos, social media profiles or health information. This is
        not a criminal record check.
      </p>

      <h2 className="text-lg font-semibold">Contact</h2>
      <p>[Data protection officer contact to be added.]</p>
    </article>
  );
}
