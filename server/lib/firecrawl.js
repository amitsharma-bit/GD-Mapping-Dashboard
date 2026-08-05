const BASE = 'https://api.firecrawl.dev';

function headers() {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error('FIRECRAWL_API_KEY is not set');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// This account's Firecrawl plan allows 5 requests/minute, TOTAL, across every endpoint
// (extract, search, crawl, and their status-poll GETs). Previously nothing paced outgoing
// requests - a single domain's poll loop plus parallel corroboration searches could easily
// attempt 15-25 requests in under a minute, so batches failed with 429s almost immediately.
// This gate makes every request wait its turn instead: no call goes out until at least
// MIN_INTERVAL_MS has passed since the last one, everywhere, so 429 shouldn't happen under
// normal operation regardless of how many callers fire "simultaneously" (e.g. Promise.all).
// 13s spacing -> ~4.6 req/min sustained, a safety margin under the 5/min ceiling.
const MIN_INTERVAL_MS = 13000;
let lastRequestAt = 0;
// Concurrent callers (corroborate() dispatches its searches via Promise.all) would otherwise
// all read the same stale `lastRequestAt` before any of them updates it, and all fire at
// once - exactly defeating the gate in the one case it matters most. Chaining each call onto
// a shared queue promise forces them to check-and-update `lastRequestAt` one at a time.
let gateQueue = Promise.resolve();

function throttle() {
  const turn = gateQueue.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  });
  gateQueue = turn.catch(() => {});
  return turn;
}

// Parses Firecrawl's 429 body (e.g. "...please retry after 1s, resets at <date>") for how
// long to actually wait, rather than guessing. Falls back to the gate's own spacing if the
// message doesn't parse. Capped so one stubborn retry can't eat the whole Vercel time budget.
function retryAfterMs(err) {
  const match = err.message?.match(/retry after (\d+)s/i);
  if (match) return Math.min(20000, Number(match[1]) * 1000 + 500);
  return MIN_INTERVAL_MS;
}

function nonRetryable(message) {
  const err = new Error(message);
  err.retryable = false;
  return err;
}

// err.status is undefined both for genuine network failures (fetch threw before any
// response) AND for our own deliberate throws below (job failed / timed out) - those must
// NOT be retried here, since a retry re-runs the whole start+poll sequence from scratch,
// burning another 30-50s we don't have. Only fetch()'s own throws are missing `.retryable`.
async function withRetry(fn, retries = 4) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const transient = err.retryable !== false && (err.status === undefined || err.status === 429 || err.status >= 500);
      if (!transient || attempt === retries) break;
      await new Promise((r) => setTimeout(r, err.status === 429 ? retryAfterMs(err) : 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function post(path, body) {
  await throttle();
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `Firecrawl ${path} failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function get(path) {
  await throttle();
  const res = await fetch(`${BASE}${path}`, { headers: headers() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `Firecrawl ${path} failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export const OWNERSHIP_SCHEMA = {
  type: 'object',
  properties: {
    company_name: { type: 'string' },
    corporate_entity: { type: 'string' },
    parent_company: { type: 'string' },
    dealer_group: { type: 'string' },
    owner: { type: 'string' },
    dealer_principal: { type: 'string' },
    ceo: { type: 'string' },
    president: { type: 'string' },
    general_manager: { type: 'string' },
    corporate_office: { type: 'string' },
    address: { type: 'string' },
    city: { type: 'string' },
    state: { type: 'string' },
    phone: { type: 'string' },
    brands: { type: 'array', items: { type: 'string' } },
    locations: { type: 'array', items: { type: 'string' } },
    number_of_stores: { type: 'number' },
    is_independently_owned: { type: 'boolean' },
    acquisition_history: { type: 'string' },
  },
};

// /v1/extract stopped working entirely (verified live: every job, even a single plain
// URL that previously succeeded, now fails with "All provided URLs are invalid" - not a
// rate-limit issue, the endpoint itself is dead despite still accepting job-start
// requests). /v2/scrape's json-format extraction is Firecrawl's stated replacement, and
// it's synchronous - one request, no job/poll loop - which also helps the rate-limit
// budget a lot: extraction now costs 1 gated request per domain instead of up to 3.
// Only scrapes the homepage - the old approach checked up to 10 pages per domain, but at
// 5 req/min account-wide that's no longer affordable. The homepage alone recovered the
// same result in testing (title/meta/JSON-LD carry the ownership facts on these sites).
// Despite the prompt saying "only fill fields explicitly stated," Firecrawl's extraction
// LLM still sometimes fills an unstated field with a placeholder string ("Not stated",
// "N/A", "Unknown") rather than omitting it - verified live. Left unfiltered, that string
// is truthy and flows straight through every `officialSiteData?.field || null` check
// downstream as if it were real data. Scrubbed here once, at the source, rather than
// patched at every call site.
const NOT_STATED_RE = /^(not stated|not specified|not mentioned|not available|n\/a|na|none|unknown)$/i;

function scrubNotStated(value) {
  if (Array.isArray(value)) return value.map(scrubNotStated).filter((v) => v !== null);
  if (typeof value === 'string') return NOT_STATED_RE.test(value.trim()) ? null : value;
  return value;
}

export async function extractOwnership(url) {
  return withRetry(async () => {
    const result = await post('/v2/scrape', {
      url,
      formats: [
        {
          type: 'json',
          schema: OWNERSHIP_SCHEMA,
          prompt:
            'Extract dealership facts explicitly stated on this page: the corporate/parent entity, dealer group name, owner, dealer principal, CEO, president, general manager, corporate office location, street address, city, state, phone number, brands carried, locations, store count, and acquisition history. Only fill fields that are explicitly stated on the page — do not infer or guess.',
        },
      ],
    });
    const data = result.data?.json;
    if (!data) return null;
    return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, scrubNotStated(v)]));
  });
}

export async function searchWeb(query, limit = 5) {
  return withRetry(async () => {
    const result = await post('/v1/search', { query, limit });
    return result.data || [];
  });
}

// Fetches a single page synchronously (no job/poll loop) - one gated request. Used to
// guarantee the homepage is always inspected even when crawlSite() below is scoped to
// specific sub-paths via includePaths, which (verified live) excludes the root path
// entirely when it doesn't match any of the given patterns.
export async function scrapePage(url) {
  return withRetry(async () => {
    const result = await post('/v2/scrape', { url, formats: ['rawHtml', 'links', 'markdown'] });
    return result.data || null;
  });
}

// Crawls up to `limit` pages from `url`, returning rawHtml/links/markdown/metadata per
// page. One /v1/crawl start + a handful of cheap status polls, vs. one /v1/scrape call per
// page - important given this account's Firecrawl plan is limited to 5 requests/minute.
// budgetMs bounds the poll loop the same way extractOwnership does (see the deadline-check
// comment there); on timeout this returns whatever pages had already finished rather than
// throwing, so a slow site still yields a partial (evidence-labeled) result instead of
// nothing.
//
// includePaths steers the crawler toward specific page types (verified live: given
// keyword patterns like ".*service.*"/".*schedule.*", it correctly discovered real pages
// like "/schedule-service/" that an unscoped crawl was missing entirely, wandering into
// arbitrary linked content instead) - but it EXCLUDES the seed/root URL if the root path
// doesn't itself match a pattern, so callers needing the homepage too must fetch it
// separately via scrapePage() (see techDetect.js).
export async function crawlSite(url, { limit = 12, budgetMs = 40000, includePaths } = {}) {
  return withRetry(async () => {
    const started = await post('/v1/crawl', {
      url,
      limit,
      maxDepth: 2,
      ...(includePaths ? { includePaths } : {}),
      scrapeOptions: { formats: ['rawHtml', 'links', 'markdown'] },
    });
    const id = started.id;
    if (!id) return [];
    const deadline = Date.now() + budgetMs;
    let last = null;
    while (Date.now() + MIN_INTERVAL_MS <= deadline) {
      last = await get(`/v1/crawl/${id}`);
      if (last.status === 'completed') return last.data || [];
      if (last.status === 'failed') throw nonRetryable('Firecrawl crawl job failed');
    }
    return last?.data || [];
  });
}
