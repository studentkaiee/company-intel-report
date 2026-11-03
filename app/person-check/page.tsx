import type { Metadata } from "next";
import { PersonForm } from "@/components/person-form";

export const metadata: Metadata = { title: "Individual Legal Screen" };
export const dynamic = "force-dynamic";

export default function PersonCheckPage() {
  const price = Number(process.env.PERSON_SCREEN_PRICE_SGD_CENTS);
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Individual Legal Screen</h1>
        <p className="mt-2 max-w-xl text-muted">
          Screen a prospective director, business partner or client. We search Singapore court judgments, MAS and other
          Singapore regulators first, then other public legal and regulatory sources, check UN and OFAC sanctions lists,
          and deliver a cited PDF. Only the name is required.
        </p>
      </section>
      {Number.isInteger(price) && price >= 50 ? (
        <PersonForm priceSgdCents={price} />
      ) : (
        <p className="text-sm text-muted">This service is not available right now.</p>
      )}
    </div>
  );
}
