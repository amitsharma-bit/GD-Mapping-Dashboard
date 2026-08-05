# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # runs Express API (localhost:8787) + Vite frontend (localhost:5173) together, via concurrently
npm run dev:server    # Express API only
npm run dev:client    # Vite frontend only
npm run build         # production frontend build (vite build -> dist/)
npm test              # runs both test files in sequence
node test/decision.test.js    # run a single test file directly
node test/techMatch.test.js   # run a single test file directly
```

There is no lint script and no test framework — `test/*.test.js` are plain Node scripts using `node:assert`, each ending with a `console.log('...: all checks passed')`. They exercise the two rule-based engines (`decision.js`, `techMatch.js`) with no network calls, so they run instantly and don't need API keys.

Requires a local `.env` (gitignored; copy `.env.example`) with `FIRECRAWL_API_KEY` and `HUBSPOT_PRIVATE_APP_TOKEN` — anything that hits `/api/process` or `/api/tech-scan` will fail without both. The Vite dev server proxies `/api/*` to `localhost:8787` (see `vite.config.js`).

Deployed on Vercel (auto-deploys on push to `main` of `amitsharma-bit/GD-Mapping-Dashboard`). `api/index.js` re-exports the Express app from `server/index.js` as a single Vercel serverless function — an Express app is itself a valid `(req, res)` handler, so no adapter is needed. `vercel.json` sets `maxDuration: 60` on that function and rewrites `/api/*` to it, everything else to `index.html` (SPA fallback).

## Architecture

Single Express backend + single-page React (Vite, no router) frontend, two independent features sharing infrastructure. `App.jsx` is a bare `useState` tab switcher between them — no other global state.

### Two pipelines

**Dealership Group Mapping** (`server/lib/pipeline.js`, UI: `DealershipMappingTab` + `ResultsTable`) — given a domain, determines its ultimate dealership-group ownership and checks it against HubSpot, read-only:
1. `firecrawl.js: extractOwnership()` — Firecrawl's `/v2/scrape` with a `json`-format extraction (LLM-based, but synchronous - one request, no polling). Only scrapes the homepage. **This used to be `/v1/extract` batching up to 10 candidate pages** (about/locations/leadership/etc.) but that endpoint stopped working entirely — verified live, every job failed with "All provided URLs are invalid" regardless of URL validity — and `/v2/scrape` is single-URL only, so checking 10 pages per domain is no longer affordable under the rate limit below anyway.
2. `firecrawl.js: searchWeb()` — web searches (Google/Automotive News/PR Newswire — trimmed from an original 5 sources, see the rate-limit note below) to corroborate the group name the site claims.
3. `decision.js: decideOwnership()` — pure rule-based scoring, no LLM: official-site claim alone = 75 confidence; each *independent* corroborating source adds 15 (capped 100); any source naming a *different* group forces `REVIEW`. `confidence >= 95` → `MAP` (if a matching HubSpot group exists) or `CREATE_NEW_GROUP`; `90–94` and `<90` both resolve to `REVIEW`, differing only in the `reason` text.
4. `hubspot.js: findGroupCandidates()` — read-only HubSpot Company search. **Important non-obvious fact:** "Dealership Group" is not a HubSpot custom object — it's a free-text Company property, `dealership_group_name`. A group's "record" is just the Company whose own `name` happens to equal its `dealership_group_name`. Matching is fuzzy (`normalize.js: namesLikelyMatch`) specifically because the same group appears under aliases (e.g. "Lithia" / "Lithia Motors" / "Lithia & Driveway") — exact-string matching was tried and failed in production testing. **The fuzzy matching has a sharp edge:** generic industry words (`motors`, `group`, `automotive`, `auto`) must be stripped in `normalizeCompanyName`'s `LEGAL_SUFFIXES`, or two *unrelated* companies that both just say e.g. "Automotive" in their name become a false-positive match — this happened live ("Sonic Automotive" matched "Battlefield Automotive" at 100% confidence) before `automotive`/`auto` were added to that list. If you add more stripped words, re-run `test/decision.test.js` — the regression test for exactly this bug is in there.
5. The app **never writes to HubSpot** — this was an explicit product decision. Output is a recommendation only.

**Technology Intelligence Agent** (`server/lib/techDetect.js`, UI: `TechIntelTab` + `TechResultsTable`) — given a domain, fingerprints its martech/DMS/CRM stack across 8 categories (website_provider, chat, reputation, crm, scheduling, ims, dms, analytics; plus digital_retail/inventory/other, detail-view-only):
1. `firecrawl.js: crawlSite()` — Firecrawl's `/v1/crawl` (one start request + polling `GET /crawl/:id`), not one `/v1/scrape` call per page. This matters: it crawls up to `limit` pages (default 12) for the cost of one request-worth of rate limit instead of N.
2. `htmlSignals.js` — regex extraction (not a DOM parser — deliberately, see file comment) of: script/iframe `src` URLs, inline script content, JSON-LD blocks, `<form action>` URLs, `<link rel=stylesheet href>` URLs, and page metadata, from each crawled page's `rawHtml`. Anchor hrefs (`linkHrefs`) come straight from Firecrawl's own `links` format — no need to regex those ourselves.
3. `techMatch.js` + `techSignatures.js` — each vendor declares ONE `domain` regex (see `techSignatures.js`'s top comment), checked against **every** evidence source, tiered by how strong a signal each source is: script src / iframe src / inline script content → confidence 100 ("strong" - the vendor's code is demonstrably loaded or its endpoint is called); page metadata / JSON-LD → 95 if ≥2 distinct hits else 90 ("moderate" - referenced in structured data, not necessarily "running"); form action / stylesheet href / plain link href → 80 ("indirect" - could just be a footer link, still real evidence though); zero hits anywhere → **not reported at all** (never guesses — there's no sub-80 "possible" tier, since below-80 would mean no evidence at all). This broad multi-source check (not just `<script src>`) is specifically what makes CRM/Service Scheduler detection viable — those tools are frequently just a "Schedule Service" link or a lead-capture form's `action=`, never a sitewide script. `techSignatures.js` is explicitly a best-effort, extensible list; a vendor not in it is a silent false negative, never a fabricated positive. Some entries (CDK, Reynolds, Tekion, DealerSocket, Dominion) intentionally appear under *multiple* categories (crm/dms/scheduling) with the *same* domain regex — these vendors genuinely sell CRM+DMS+Scheduler as one platform, and there's no way to tell which module is actually in use from the domain alone.
4. Company name / country / state / `is_us_dealership` are read only from JSON-LD structured data (`techDetect.js: determineGeo`) — never inferred from page prose. `is_us_dealership` defaults `true` absent contrary evidence (a non-US ccTLD or explicit non-US address) rather than requiring positive proof, since a missing address isn't evidence either way.
5. **Real ceiling, not a bug:** many dealership CRM/DMS systems are 100% internal/backend tools with zero public-website footprint (staff use them in-office; nothing about them ever touches the customer-facing site). No amount of better regex/evidence-source coverage can detect a system that leaves no trace on the crawled pages — an empty CRM/DMS column can be a correct "no evidence exists to find," not a detection failure.

### The constraint that shapes both pipelines

This account's **Firecrawl plan is rate-limited to 5 requests/minute, TOTAL, across every endpoint** (extract, search, crawl, and their status-poll GETs), and the app targets **Vercel Hobby's 60-second function timeout** (`vercel.json: functions.maxDuration`). Several design choices exist specifically because of this — don't "simplify" them away without re-reading why:
- **Every outgoing Firecrawl request is paced through a shared gate** (`firecrawl.js`: `throttle()`/`MIN_INTERVAL_MS = 13000`) that enforces ≥13s between requests, globally, regardless of how many callers fire "concurrently" via `Promise.all`. This didn't exist originally — without it, a single domain's own poll loop plus parallel corroboration searches could attempt 15-25 requests in under a minute and 429 almost immediately, which is exactly what happened in production. The gate is implemented as a promise chain (not a plain "check timestamp, then wait" function), because a naive version lets concurrent callers race and all read the same stale timestamp before any of them updates it — defeating the gate specifically in the `Promise.all` case it needs to handle.
- On a 429, `withRetry()` parses Firecrawl's actual `"retry after Xs"` text and waits that long, rather than a blind fixed backoff.
- Both `extractOwnership()` (now a single `/v2/scrape` call, no polling) and `crawlSite()` bound their work to fit this pacing within Vercel's 60s ceiling. `crawlSite()`'s poll loop checks `Date.now() + MIN_INTERVAL_MS <= deadline` (not just `Date.now() < deadline`) before each poll — otherwise the gate can block a poll past its own deadline once already committed to it.
- `pipeline.js`'s `CORROBORATION_QUERIES` is capped at 3 (was 5) — at 13s/request, each additional query costs ~13s against the 60s ceiling.
- The frontend processes bulk batches (paste list / CSV / Excel, parsed client-side in `src/lib/parseFile.js` using `xlsx` for both formats) **one domain at a time, sequentially** — this is deliberate rate-limit pacing, not a missed optimization opportunity.
- `/v1/crawl` was chosen over N separate `/v1/scrape` calls in the tech-intel pipeline for the same reason.
- If you raise `CORROBORATION_QUERIES`, `limit` in `crawlSite()`, or add pages back to the ownership pipeline, re-check the total-request-count math against `MIN_INTERVAL_MS` and Vercel's timeout — it's easy to silently blow one or the other again.

### Frontend state

No global store. Each tab component (`DealershipMappingTab`, `TechIntelTab`) owns its own results in `useState`, persisted to its own `localStorage` key (`gd-mapping-results`, `gd-tech-intel-results`) so a batch survives a page refresh — completed domains are skipped on re-run, incomplete ones resume. Styling is a single global stylesheet (`src/styles.css`, design tokens as CSS custom properties) with plain `className`s — no CSS-in-JS, no Tailwind.
