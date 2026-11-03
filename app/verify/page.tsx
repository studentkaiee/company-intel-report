import type { Metadata } from "next";
import { VerifyForm } from "@/components/verify-form";

export const metadata: Metadata = { title: "Verify an Individual Legal Screen" };

export default function VerifyPage() {
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Verify an Individual Legal Screen</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Enter the details printed on the PDF&apos;s cover and summary. We recompute the verification code from them; nothing
          is looked up or stored, so a match shows these details weren&apos;t changed after we issued the report.
        </p>
      </section>
      <VerifyForm />
    </div>
  );
}
