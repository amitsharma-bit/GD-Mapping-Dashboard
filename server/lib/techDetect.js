import { crawlSite } from './firecrawl.js';
import { mergeSignals } from './htmlSignals.js';
import { detectTechnologies } from './techMatch.js';
import { normalizeDomain } from './normalize.js';

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
    const pages = await crawlSite(`https://${domain}`, { limit: 12 });
    if (!pages.length) {
      return { domain, error: true, reason: 'Site could not be crawled (no pages returned).' };
    }

    const normalizedPages = pages.map((p) => ({
      url: p.metadata?.url || p.metadata?.sourceURL || domain,
      rawHtml: p.rawHtml || '',
      metadata: p.metadata || {},
    }));
    const merged = mergeSignals(normalizedPages);

    const geo = determineGeo(merged.jsonLd, domain);
    const homepage = normalizedPages[0]?.metadata || {};
    const companyName = geo.companyName || homepage['og:site_name'] || homepage.title || null;

    const detected = detectTechnologies(merged);
    const categories = { chat: [], website_provider: [], crm: [], inventory: [], digital_retail: [], reputation: [], analytics: [], scheduling: [], other: [] };
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
