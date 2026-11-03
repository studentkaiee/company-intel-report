# Company Intelligence Report Service

A paid web app: the user types a company name, the app researches the company on the
web, shows a free preview, takes payment, and delivers a cited PDF report.

Hard constraints (never break these):
- **No database.** No Postgres, SQLite, Redis, KV, Supabase, Firebase, or files on disk used as storage.
  Stripe is the only system of record. State lives in the browser, in Stripe metadata, or in signed tokens.
- **No sign-in or accounts.** No auth library, no magic links, no user table.
- **Paid export.** The full report and PDF are only produced after the server has confirmed payment with Stripe.

## Stack

- Next.js (App Router) + TypeScript, deployed on Vercel. Tailwind for styling.
- Anthropic SDK (`@anthropic-ai/sdk`) for research, using the server-side web search and web fetch tools.
  - Quick scan model: `claude-haiku-5-5`. Deep research model: `claude-sonnet-5-5`.
  - Check the current tool type names and params in the Claude API docs before writing tool code; don't guess them.
- Company registry: ACRA open data via the data.gov.sg datastore API (free, no key). Dataset
  "Entities Registered with ACRA", id `d_3f960c10fed6145404ca7b821f263b87`.
  Endpoint pattern: `https://data.gov.sg/api/action/datastore_search?resource_id=<id>&q=<name>`.
  Gives UEN, entity name, status, type, registration date, address. No directors/shareholders.
- Payments: Stripe Embedded Checkout (`ui_mode: 'embedded'`), one-time payment, SGD.
- PDF: `@react-pdf/renderer`, rendered server-side in a route handler.
- Bot protection: Cloudflare Turnstile on the search form, verified server-side.
- Email of the PDF (later phase): Resend.

## User flow

1. **Search.** User enters a company name (+ Turnstile). `POST /api/resolve` queries ACRA and returns
   up to 10 candidates. User picks one (UEN). Non-Singapore companies: allow "search the web instead".
2. **Quick scan (free, cheap).** `POST /api/scan` with the UEN + name. Haiku with max 5 web searches
   finds the website and a few facts. Streams progress to the page. Returns a `Preview`: snapshot
   section in full, other section headings with a count of sources found, rest shown blurred.
   Hard cap: max_uses 5 searches, max tokens small. Target cost under US$0.05.
3. **Pay.** `POST /api/checkout` creates an embedded Checkout Session. Put `uen`, `company_name`,
   and `website` in session metadata. Price from env `REPORT_PRICE_SGD_CENTS`.
4. **Deep research + PDF.** After payment, the page calls `POST /api/report` with the `session_id`.
   The handler:
   - retrieves the session from Stripe, requires `payment_status === 'paid'`;
   - reads the PaymentIntent metadata `report_runs`; refuse if >= 3 (stops endless free reruns), else increment it
     (this is how we "store" usage without a database);
   - runs the deep research agent (Sonnet, max ~25 searches), streaming progress events;
   - validates output against the `Report` zod schema;
   - renders the PDF and returns it (or returns the JSON and a second call renders the PDF).
   - Registry facts (UEN, status, address, dates) come from ACRA, never from the model.

## Report schema (zod, in `lib/report-schema.ts`)

Sections, each with `items: { text, sourceIds[] }[]` and `confidence: 'high'|'medium'|'low'`:
1. snapshot (from registry + website)
2. corporateStructure (officers, parent/subsidiaries if publicly reported)
3. productsAndServices
4. marketingStrategy (positioning, channels, messaging, recent campaigns)
5. marketAndCompetitors
6. newsAndReputation
7. riskFlags (struck off, adverse media, inconsistencies)
8. sources: `{ id, title, url, retrievedAt }[]`

Every item must cite at least one source id. If a section has no evidence, return an empty
`items` list and a note "No public information found" — never invent content.

## Research agent rules (system prompt essentials)

- Research only the registered entity given (name + UEN). Disambiguate by website/address.
- Summarise in your own words; no long quotes. No home addresses, photos, or personal social
  profiles of individuals; officers' names and roles only.
- Don't use logged-in sites (LinkedIn etc.). Respect robots.txt.
- Output JSON only, matching the schema.

## Security

- Never trust the client for payment state; always retrieve the Stripe session server-side.
- Verify Stripe webhooks with the signing secret if a webhook is added.
- Don't log request bodies or report content. No analytics scripts on report pages.
- All secrets in env vars (see `.env.example`); never expose them to the client.
- Rate limit `/api/scan` and `/api/resolve` with Vercel/Cloudflare platform rules, not app storage.

## Env vars

ANTHROPIC_API_KEY, STRIPE_SECRET_KEY, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET,
TURNSTILE_SECRET_KEY, NEXT_PUBLIC_TURNSTILE_SITE_KEY, REPORT_PRICE_SGD_CENTS, RESEND_API_KEY (later)

## Conventions

- TypeScript strict. Zod for all API inputs and model outputs.
- Small route handlers in `app/api/*/route.ts`; logic in `lib/`.
- Tests with Vitest for schema validation, Stripe gating logic, and ACRA parsing (mock network).
- Before saying a task is done: run `npm run lint`, `npm run typecheck`, `npm test`.
- Long research must stream progress and stay inside Vercel function duration limits; set
  `maxDuration` on the route and check the current plan limit.

## Legal copy to include

- Disclaimer on preview and in the PDF: compiled from public sources by AI, may contain errors,
  not legal/financial advice, not a regulated KYC check, verify before relying on it.
- Terms + privacy pages (placeholders until reviewed by a Singapore lawyer).
