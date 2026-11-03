import type { Metadata } from "next";
import { Suspense } from "react";
import { PersonReportClient } from "@/components/person-report-client";

export const metadata: Metadata = { title: "Your Individual Legal Screen", robots: { index: false, follow: false } };

export default function PersonReportPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <PersonReportClient />
    </Suspense>
  );
}
