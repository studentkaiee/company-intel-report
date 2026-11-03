import type { Metadata } from "next";
import { DISCLAIMER } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of service" };

export default function TermsPage() {
  return (
    <article className="space-y-4 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Terms of service</h1>
      <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800">
        Placeholder. These terms have not yet been reviewed by a Singapore-qualified lawyer and must be before launch.
      </p>
      <h2 className="text-lg font-semibold">1. The service</h2>
      <p>
        We compile reports about companies from publicly available sources using automated AI research, together with
        registry data published by ACRA on data.gov.sg.
      </p>
      <h2 className="text-lg font-semibold">2. No advice; accuracy</h2>
      <p>{DISCLAIMER}</p>
      <h2 className="text-lg font-semibold">3. Payment and report runs</h2>
      <p>
        Payment is processed by Stripe. Each purchase entitles you to generate the report for the selected company up to
        three times. Reports are delivered in your browser and as a downloadable PDF; we do not keep a copy for you.
      </p>
      <h2 className="text-lg font-semibold">4. Refunds</h2>
      <p>[To be completed.]</p>
      <h2 className="text-lg font-semibold">5. Acceptable use</h2>
      <p>
        You must not use reports to harass individuals, for unlawful discrimination, or for any purpose that breaches
        Singapore law, including the Personal Data Protection Act 2012.
      </p>
      <h2 className="text-lg font-semibold">6. Liability</h2>
      <p>[To be completed.]</p>
      <h2 className="text-lg font-semibold">7. Governing law</h2>
      <p>These terms are governed by the laws of Singapore.</p>
    </article>
  );
}
