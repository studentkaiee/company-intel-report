import Link from "next/link";
import { ResearchFlow } from "@/components/research-flow";

export default function Home() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Know who you&apos;re dealing with.</h1>
        <p className="mt-2 max-w-xl text-muted">
          Type a company name. We match it against the ACRA registry, scan the web for a free preview, and after
          payment deliver a full, cited report as a PDF.
        </p>
        <p className="mt-2 text-sm">
          Checking a person instead?{" "}
          <Link href="/person-check" className="text-accent hover:underline">
            Run an Individual Legal Screen
          </Link>
        </p>
      </section>
      <ResearchFlow />
    </div>
  );
}
