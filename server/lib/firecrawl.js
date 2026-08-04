const BASE = 'https://api.firecrawl.dev/v1';

function headers() {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error('FIRECRAWL_API_KEY is not set');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function withRetry(fn, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const transient = err.status === undefined || err.status === 429 || err.status >= 500;
      if (!transient || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function post(path, body) {
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
    brands: { type: 'array', items: { type: 'string' } },
    locations: { type: 'array', items: { type: 'string' } },
    number_of_stores: { type: 'number' },
    is_independently_owned: { type: 'boolean' },
    acquisition_history: { type: 'string' },
  },
};

// ponytail: /v1/extract is flagged deprecated by Firecrawl in favor of /v2/scrape's
// json-format option; migrate if v1 stops working. Also caps at 10 URLs per request.
//
// budgetMs bounds the poll loop so a single slow domain fails fast (as a REVIEW result,
// see pipeline.js) with time to spare inside Vercel's 60s Hobby function ceiling, rather
// than running until the platform kills the whole request. Raise this if deployed with a
// higher function timeout (Pro, or Fluid Compute).
export async function extractOwnership(urls, budgetMs = 45000) {
  return withRetry(async () => {
    const started = await post('/extract', {
      urls,
      schema: OWNERSHIP_SCHEMA,
      prompt:
        'Extract dealership ownership facts explicitly stated on this page: the corporate/parent entity, dealer group name, owner or dealer principal, CEO, brands carried, locations, store count, and acquisition history. Only fill fields that are explicitly stated on the page — do not infer or guess.',
    });
    if (started.data) return started.data;
    const id = started.id;
    if (!id) return null;
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await get(`/extract/${id}`);
      if (poll.status === 'completed') return poll.data;
      if (poll.status === 'failed') throw new Error('Firecrawl extract job failed');
    }
    throw new Error('Firecrawl extract timed out');
  });
}

export async function searchWeb(query, limit = 5) {
  return withRetry(async () => {
    const result = await post('/search', { query, limit });
    return result.data || [];
  });
}

// Crawls up to `limit` pages from `url`, returning rawHtml/links/metadata per page.
// One /v1/crawl start + a handful of cheap status polls, vs. one /v1/scrape call per
// page - important given this account's Firecrawl plan is limited to 5 requests/minute.
// budgetMs bounds the poll loop the same way extractOwnership does; on timeout this
// returns whatever pages had already finished rather than throwing, so a slow site still
// yields a partial (evidence-labeled) result instead of nothing.
export async function crawlSite(url, { limit = 12, budgetMs = 40000, includePaths } = {}) {
  return withRetry(async () => {
    const started = await post('/crawl', {
      url,
      limit,
      maxDepth: 2,
      ...(includePaths ? { includePaths } : {}),
      scrapeOptions: { formats: ['rawHtml', 'links'] },
    });
    const id = started.id;
    if (!id) return [];
    const deadline = Date.now() + budgetMs;
    let last = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      last = await get(`/crawl/${id}`);
      if (last.status === 'completed') return last.data || [];
      if (last.status === 'failed') throw new Error('Firecrawl crawl job failed');
    }
    return last?.data || [];
  });
}
