import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Company Intelligence Report",
  description: "Cited company research reports compiled from public sources.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
            <Link href="/" className="font-semibold tracking-tight">
              Company Intelligence Report
            </Link>
            <span className="text-xs text-muted">Singapore companies · cited sources · PDF</span>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
        <footer className="mx-auto max-w-3xl px-4 pb-10 text-xs text-muted">
          <nav className="flex flex-wrap gap-4">
            <Link href="/person-check" className="hover:underline">
              Individual Legal Screen
            </Link>
            <Link href="/verify" className="hover:underline">
              Verify a report
            </Link>
            <Link href="/terms" className="hover:underline">
              Terms
            </Link>
            <Link href="/privacy" className="hover:underline">
              Privacy
            </Link>
          </nav>
        </footer>
      </body>
    </html>
  );
}
