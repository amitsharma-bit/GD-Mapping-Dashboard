import { crawlSite, scrapePage } from './firecrawl.js';
import { mergeSignals } from './htmlSignals.js';
import { detectTechnologies } from './techMatch.js';
import { normalizeDomain } from './normalize.js';

// Keyword roots covering every page the detection engine is meant to inspect (about,
// contact, inventory, new, used, finance, trade, sell-your-car, service, service-center,
// schedule-service, service-scheduler, parts, body-shop, privacy-policy, terms, login,
// customer-login, owner-portal) - collapsed to distinct roots since e.g. "service" alone
// as a substring pattern already covers service-center/schedule-service/service-scheduler,
// and "login" covers customer-login. Passed to crawlSite's includePaths, which (verified
// live against a real dealer site) successfully steers the crawler to real pages like
// "/schedule-service/" that a plain unscoped crawl was missing entirely.
const PAGE_DISCOVERY_PATTERNS = [
  'about', 'contact', 'inventory', 'new', 'used', 'finance', 'trade', 'sell',
  'service', 'parts', 'body', 'privacy', 'terms', 'login', 'portal',
].map((keyword) => `.*${keyword}.*`);

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

function flattenJsonLd(entries) {
  const out = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      if (node['@type']) out.push(node);
      if (node['@graph']) walk(node['@graph']);
    }
  };
  entries.forEach(({ data }) => walk(data));
  return out;
}

function findBusinessEntity(jsonLdEntries) {
  const flattened = flattenJsonLd(jsonLdEntries);
  return flattened.find((e) => {
    const type = Array.isArray(e['@type']) ? e['@type'].join(',') : e['@type'] || '';
    return /organization|autodealer|localbusiness|corporation/i.test(type);
  });
}

// Only reports what's explicitly evidenced in JSON-LD structured data - never guesses a
// state/country from prose. is_us_dealership defaults true absent any contrary evidence
// (a non-US ccTLD, or an explicit non-US address), since a missing address isn't proof of
// anything either way.
function determineGeo(jsonLdEntries, domain) {
  const entity = findBusinessEntity(jsonLdEntries);
  const address = entity?.address;
  const addr = Array.isArray(address) ? address[0] : address;

  let country = '';
  let state = '';
  if (addr) {
    country = addr.addressCountry?.name || addr.addressCountry || '';
    state = addr.addressRegion || '';
  }

  const nonUsCountry = country && !/^(us|usa|united states)$/i.test(country);
  const nonUsTld = /\.(ca|uk|co\.uk|de|mx|au|fr|it|es|nl|br|in|jp)$/i.test(domain);
  const isUs = !nonUsCountry && !nonUsTld;

  if (!country && state && US_STATES.has(state.toUpperCase())) country = 'United States';

  return { country, state, isUs, companyName: entity?.name || null };
}

export async function detectTechStack(rawDomain) {
  const domain = normalizeDomain(rawDomain);
  if (!domain) {
    return { domain: rawDomain, error: true, reason: 'Empty or invalid domain.' };
  }

  try {
    const homeUrl = `https://${domain}`;
    // Homepage first and separately - crawlSite's includePaths scoping (needed for
    // reaching /service, /schedule-service, /inventory etc.) excludes the root path
    // itself when it doesn't match one of those keyword patterns, but the homepage
    // carries most of the sitewide signals (analytics, chat widgets, website-provider
    // markers) that already worked well, so it can't be dropped.
    const [homepagePage, crawledPages] = await Promise.all([
      scrapePage(homeUrl).catch(() => null),
      crawlSite(homeUrl, { limit: 20, includePaths: PAGE_DISCOVERY_PATTERNS }),
    ]);

    const pages = homepagePage
      ? [{ ...homepagePage, metadata: { ...homepagePage.metadata, url: homeUrl } }, ...crawledPages]
      : crawledPages;
    if (!pages.length) {
      return { domain, error: true, reason: 'Site could not be crawled (no pages returned).' };
    }

    const normalizedPages = pages.map((p) => ({
      url: p.metadata?.url || p.metadata?.sourceURL || domain,
      rawHtml: p.rawHtml || '',
      metadata: p.metadata || {},
      links: p.links || [],
      markdown: p.markdown || '',
    }));
    const merged = mergeSignals(normalizedPages);

    const geo = determineGeo(merged.jsonLd, domain);
    const homepageMeta = normalizedPages[0]?.metadata || {};
    const companyName = geo.companyName || homepageMeta['og:site_name'] || homepageMeta.title || null;

    const detected = detectTechnologies(merged);
    const categories = {
      chat: [], website_provider: [], crm: [], scheduling: [], ims: [], dms: [],
      inventory: [], digital_retail: [], reputation: [], analytics: [], other: [],
    };
    for (const tech of detected) {
      (categories[tech.category] || categories.other).push(tech.name);
    }

    const externalDomains = new Set(
      [...merged.scriptSrcs, ...merged.iframeSrcs]
        .map(({ src }) => {
          try {
            return new URL(src, `https://${domain}`).hostname;
          } catch {
            return null;
          }
        })
        .filter((host) => host && host !== domain && !host.endsWith(`.${domain}`))
    );

    const result = {
      domain,
      company_name: companyName,
      country: geo.country,
      state: geo.state,
      is_us_dealership: geo.isUs,
      categories,
      detected_technologies: detected,
      crawl_summary: {
        pages_crawled: normalizedPages.length,
        scripts_analyzed: new Set(merged.scriptSrcs.map((s) => s.src)).size,
        external_domains: externalDomains.size,
      },
    };
    if (!geo.isUs) result.status = 'NON_US_DEALERSHIP';
    return result;
  } catch (err) {
    return { domain, error: true, reason: `Processing failed: ${err.message}` };
  }
}
