import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportClient } from "@/components/report-client";

export const metadata: Metadata = { title: "Your report", robots: { index: false, follow: false } };

export default function ReportPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <ReportClient />
    </Suspense>
  );
}
