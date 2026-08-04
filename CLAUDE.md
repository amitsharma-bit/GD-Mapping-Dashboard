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
1. `firecrawl.js: extractOwnership()` — Firecrawl's `/v1/extract` (LLM-based, async: POST starts a job, poll `GET /extract/:id` until `completed`) pulls ownership facts from up to 10 explicit candidate pages (home/about/locations/leadership/contact/press/privacy — **capped at 10, Firecrawl rejects more per request**).
2. `firecrawl.js: searchWeb()` — parallel web searches (Google/LinkedIn/PR Newswire/Business Wire/Automotive News) to corroborate the group name the site claims.
3. `decision.js: decideOwnership()` — pure rule-based scoring, no LLM: official-site claim alone = 75 confidence; each *independent* corroborating source adds 15 (capped 100); any source naming a *different* group forces `REVIEW`. `confidence >= 95` → `MAP` (if a matching HubSpot group exists) or `CREATE_NEW_GROUP`; `90–94` and `<90` both resolve to `REVIEW`, differing only in the `reason` text.
4. `hubspot.js: findGroupCandidates()` — read-only HubSpot Company search. **Important non-obvious fact:** "Dealership Group" is not a HubSpot custom object — it's a free-text Company property, `dealership_group_name`. A group's "record" is just the Company whose own `name` happens to equal its `dealership_group_name`. Matching is fuzzy (`normalize.js: namesLikelyMatch`) specifically because the same group appears under aliases (e.g. "Lithia" / "Lithia Motors" / "Lithia & Driveway") — exact-string matching was tried and failed in production testing.
5. The app **never writes to HubSpot** — this was an explicit product decision. Output is a recommendation only.

**Technology Intelligence Agent** (`server/lib/techDetect.js`, UI: `TechIntelTab` + `TechResultsTable`) — given a domain, fingerprints its martech stack:
1. `firecrawl.js: crawlSite()` — Firecrawl's `/v1/crawl` (one start request + polling `GET /crawl/:id`), not one `/v1/scrape` call per page. This matters: it crawls up to `limit` pages (default 12) for the cost of one request-worth of rate limit instead of N.
2. `htmlSignals.js` — regex extraction (not a DOM parser — deliberately, see file comment) of script/iframe `src` URLs, inline script content, and JSON-LD blocks from each page's `rawHtml`.
3. `techMatch.js` + `techSignatures.js` — matches extracted signals against a curated vendor fingerprint dictionary (chat/CRM/website-provider/analytics/reputation/scheduling/digital-retail). Confidence is mechanical: any script/iframe URL match = 100; ≥2 deduped weaker signals (inline script / meta tag / JSON-LD) = 95; exactly 1 = 90; zero = **not reported at all** (never guesses — there is no "possible" tier below 90). `techSignatures.js` is explicitly a best-effort, extensible list; a vendor not in it is a silent false negative, never a fabricated positive.
4. Company name / country / state / `is_us_dealership` are read only from JSON-LD structured data (`techDetect.js: determineGeo`) — never inferred from page prose. `is_us_dealership` defaults `true` absent contrary evidence (a non-US ccTLD or explicit non-US address) rather than requiring positive proof, since a missing address isn't evidence either way.

### The constraint that shapes both pipelines

This account's **Firecrawl plan is rate-limited to 5 requests/minute**, and the app targets **Vercel Hobby's 60-second function timeout** (`vercel.json: functions.maxDuration`). Several design choices exist specifically because of this — don't "simplify" them away without re-reading why:
- Both `extractOwnership()` and `crawlSite()` poll on an **elapsed-time budget** (`budgetMs`), not a fixed iteration count, so a slow domain fails gracefully as a `REVIEW`/error result with margin to spare, instead of the whole request getting killed by the platform.
- Corroboration searches in `pipeline.js` run via `Promise.all` (parallel), not sequentially — this alone cut a single scan from ~90s to ~35s.
- The frontend processes bulk batches (paste list / CSV / Excel, parsed client-side in `src/lib/parseFile.js` using `xlsx` for both formats) **one domain at a time, sequentially** — this is deliberate rate-limit pacing, not a missed optimization opportunity.
- `/v1/crawl` was chosen over N separate `/v1/scrape` calls in the tech-intel pipeline for the same reason.

### Frontend state

No global store. Each tab component (`DealershipMappingTab`, `TechIntelTab`) owns its own results in `useState`, persisted to its own `localStorage` key (`gd-mapping-results`, `gd-tech-intel-results`) so a batch survives a page refresh — completed domains are skipped on re-run, incomplete ones resume. Styling is a single global stylesheet (`src/styles.css`, design tokens as CSS custom properties) with plain `className`s — no CSS-in-JS, no Tailwind.
