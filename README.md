# Company Intelligence Report

Paid web app: search a company, get a free AI quick scan, pay with Stripe, receive a cited PDF report.
No database, no accounts. Stripe is the only system of record. See `CLAUDE.md` for the full spec.

## Setup

Requires Node 20.9+.

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

`REPORT_SIGNING_SECRET` is extra to the original spec: an HMAC key for the signed tokens that carry state
through the browser (scan tickets, preview tokens, report signatures). Generate one with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

## Flow

| Step | Route | Notes |
| --- | --- | --- |
| Search | `POST /api/resolve` | Turnstile verified server-side. ACRA lookup (field-scoped name query). Returns candidates, each with a signed 30-min **scan ticket**. |
| Quick scan | `POST /api/scan` | Needs a scan ticket. Haiku 5.5, max 5 web searches. Streams NDJSON progress. Returns a `Preview` plus a signed **preview token**. |
| Pay | `POST /api/checkout` | Needs a preview token (so metadata can't be forged). Embedded Checkout, SGD, price from `REPORT_PRICE_SGD_CENTS`. |
| Report | `POST /api/report` | Retrieves the session from Stripe, requires `paid`, increments `report_runs` on the PaymentIntent (max 3), runs Sonnet 5.5 deep research **and, in parallel, a litigation check** (see below), streams progress. Returns the report JSON and an HMAC binding it to the session. On success, emails the PDF to the Checkout email via Resend (if configured). If the 3rd run fails and none ever succeeded, refunds the payment in full. |
| PDF | `POST /api/pdf` | Verifies the HMAC and that the session is paid, then renders with `@react-pdf/renderer`. Does not use a run. |

The finished report is cached in the buyer's `localStorage` (keyed by Checkout Session), so a refresh doesn't re-run research.

### Litigation and court records (company report)

The company report's main check: is the company involved in litigation, or does it have a court history in
Singapore? `lib/company-litigation.ts` uses the Individual Legal Screen's logic:

- Two Claude calls in parallel: **Singapore court and regulator sites** (`allowed_domains` = `SG_OFFICIAL_SOURCES`,
  high effort) and **other public legal sources** (open web, Singapore news media blocked).
- Required searches: the registered name, the name without "Pte. Ltd.", "Public Prosecutor", judgment / appeal /
  winding up, enforcement terms, judicial management / liquidation / striking off, and the UEN.
- Findings must link to URLs from that call's own results; anything on judiciary.gov.sg or eLitigation is a strong
  match. Only cases where the company itself is a party are reported.
- Sanctions: the company name is screened against the UN and OFAC **entity** lists (`data/sanctions/*-entities.json`).
  Every word of the company's name must appear in a listed name, so generic words alone don't match.
- Shown near the top of the report page and PDF, before the business sections, as `report.litigation`. Reports saved
  in browsers before this was added still open (the field is optional).

## Trust boundaries

- Registry facts (UEN, status, type, dates, address) come from ACRA only, never from the model.
- Model output is validated with zod (`lib/report-schema.ts`). Any source URL the model cites that did not appear in
  that run's web search or fetch results is dropped, along with the claims that relied only on it (`groundSections`).
- Server-side refusal fallback (`fallbacks: "default"`) is enabled on the Sonnet deep-research call.

## Cost tracking

Every scan and report run logs one JSON line (`"event":"research_usage"`) with token counts, web searches,
web fetches, duration and an estimated US$ cost. It contains counts only, never company names or report content.
Search Vercel logs for `research_usage` to see real costs. Report runs also write `cost_usd_last_run`,
`cost_usd_total`, `web_searches_total` and `tokens_last_run` to the PaymentIntent metadata, so each payment in the
Stripe dashboard shows what it cost to fulfil. Prices live in `lib/cost.ts`; update them if Anthropic pricing changes.

## Individual Legal Screen (`/person-check`)

A second paid product: the buyer enters an individual's details, pays, and gets a PDF listing possible legal and
regulatory matters found on Singapore court and regulator websites and other public legal sources, plus a
sanctions-list result. Singapore news media are not searched. **It is not a criminal record check** (Singapore
criminal records are not public), and the page and PDF say so.

| Step | Route | Notes |
| --- | --- | --- |
| Form | `/person-check` | Only the full name (and the consent confirmation) is required. Optional: up to 3 aliases, name in local script, DOB, nationality, occupation, company, purpose. No NRIC/FIN/passport field; anything NRIC/FIN-shaped in any field is rejected. Details are kept in `sessionStorage` only. |
| Pay | `POST /api/person-checkout` | Turnstile verified. Validates the inputs and creates an Embedded Checkout Session whose metadata is only `{ product: "person_screen", inputHash }`, where `inputHash = HMAC-SHA256(REPORT_HMAC_SECRET, canonicalJSON(inputs))`. |
| Screen | `POST /api/person-report` | Needs the session ID and the same inputs. Requires `paid`, `product === "person_screen"`, session under 24 h old, matching `inputHash`, and fewer than 3 runs. Runs the sanctions check, then two Claude calls in parallel, each with direct-only `web_search` (located in Singapore) and `web_fetch` (8 uses): **Singapore court and regulator sites** (`allowed_domains` = `SG_OFFICIAL_SOURCES`, high effort, the priority source) and **other public legal sources** (open web with Singapore news media blocked, medium effort). Each call gets a **required search list** built in `lib/person/queries.ts` (the name and each alias, with "Public Prosecutor", judgment, enforcement and disciplinary keywords) and 6 extra searches for follow-ups. If the model answers before running them all, it is sent back once to run the missing ones. Streams progress. Returns `{ report, signature }`. |
| PDF | `POST /api/person-pdf` | Re-renders the PDF from the report the browser holds; the HMAC signature proves the server produced it. No Claude call, no Stripe call. |
| Verify | `/verify`, `POST /api/verify-person` | Recomputes the PDF's verification code from the report ID, name, DOB, finding counts and sanctions result. Stateless. |

What keeps it honest:

- **Only the name, aliases, local-script name, year of birth, nationality, occupation and company** are sent to Claude.
  The full date of birth is used only for local sanctions matching.
- **Grounding.** A finding is dropped unless its `source_url` appeared in that call's web search or fetch results;
  extra URLs that didn't appear are dropped too. Weak (name-only) matches go to an appendix only when there are 3 or fewer.
- **PII scrubbing.** NRIC/FIN-like values, emails and phone numbers are removed from model text.
- **Case stages.** Each finding records how far the case got; an acquittal or withdrawal outranks earlier reports.
- **Court records are strong matches.** Any finding sourced from judiciary.gov.sg or elitigation.sg (the Judiciary's
  judgments site) is set to `strong` in code, whatever the model rated it, with a note in the match evidence.
  Findings from Singapore official sources are listed first.
- **Failure handling.** Each research call gets one retry. If either still fails, the run fails (no half-finished
  report). Each purchase gets 3 runs; if all 3 fail, the payment is refunded automatically. The failure page shows
  the session ID and a mailto refund link (`NEXT_PUBLIC_SUPPORT_EMAIL`).
- **Logs** record counts only (`"kind":"person_screen"` with a request ID, model, tokens, searches, findings, duration).

### Which sites are searched

Set in `lib/person/outlets.ts`:

- **`SG_OFFICIAL_SOURCES`** (searched first, via `allowed_domains`): judiciary.gov.sg, elitigation.sg, mas.gov.sg,
  sgx.com, acra.gov.sg, cccs.gov.sg, pdpc.gov.sg, mom.gov.sg, police.gov.sg, agc.gov.sg, lawsociety.org.sg,
  singaporelawwatch.sg.
- **`SG_MEDIA_DOMAINS`** (never searched, blocked on the open-web call): The Straits Times, CNA, TODAY, Business Times,
  The New Paper, Zaobao, Berita Harian, Tamil Murasu, Mothership, AsiaOne, Yahoo News Singapore and others.
- **`site:` doesn't work:** the search provider ignores it, which is why sites are chosen with
  `allowed_domains` / `blocked_domains`.
- **Re-check periodically.** If a site in `SG_OFFICIAL_SOURCES` starts blocking Anthropic's crawler, the API rejects
  the call with a 400 and every screen fails. Run:

```bash
node --env-file=.env.local scripts/check-outlets.mjs
```

### Sanctions lists

`data/sanctions/un.json` and `ofac.json` are trimmed copies (individuals only: names, aliases, birth dates,
nationalities) of the UN Security Council Consolidated List and the US OFAC SDN list. Refresh them, then redeploy:

```bash
node scripts/update-sanctions.mjs
```

Singapore applies UN sanctions through MAS regulations, so the UN list covers MAS targeted financial sanctions.
`data/sanctions/tsofa.json` (individuals in the First Schedule of the Terrorism (Suppression of Financing) Act) is
maintained by hand and ships **empty**: until you fill it in and set `asOf`, reports show that list as "not checked".

Matching normalises accents, punctuation and honorifics, compares names in any word order with Jaro-Winkler
similarity, and rules out entries whose listed year of birth is more than a year away. Results are "possible match",
never "hit".

### Setup

- Env vars: `REPORT_HMAC_SECRET` (32+ random chars, separate from `REPORT_SIGNING_SECRET`), `CLAUDE_MODEL`
  (default `claude-sonnet-5-5`; must support `web_search_20260209`, so Sonnet 5.5 or Opus 5.5),
  `PERSON_SCREEN_PRICE_SGD_CENTS` (leave blank to switch the product off), `NEXT_PUBLIC_SUPPORT_EMAIL`.
- **Claude Console:** web search (and web fetch) must be enabled for your organisation in the Console's
  organisation settings, otherwise the research calls fail.
- Add Vercel Firewall / Cloudflare rate-limit rules for `/api/person-checkout`, `/api/person-report`,
  `/api/person-pdf` and `/api/verify-person`.
- The PDF follows the business's existing AML/CFT search report layout: blue title band, name and country, search
  line, two-column result table, grey footer with the timestamp and page
  numbers, then an explanatory page.
- The PDF uses the built-in Helvetica font, which can't draw Chinese, Jawi or Tamil characters. A name in local
  script appears on the web page but is marked "shown on the web page only" in the PDF.
- Have a Singapore lawyer review the consent wording, `/person-check/privacy` and the limitations text before launch.

## Deploying on Vercel

- Set all env vars from `.env.example` in the project settings.
- `/api/report` sets `maxDuration = 300` (Hobby limit with fluid compute). On Pro, raise it to 800.
- Add rate-limit rules for `/api/resolve` and `/api/scan` in Vercel Firewall or Cloudflare (not in app code).

## Checks

```bash
npm run lint
npm run typecheck
npm test
```
