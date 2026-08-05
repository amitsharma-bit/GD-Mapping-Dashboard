import { extractOwnership, searchWeb } from './firecrawl.js';
import { findCompanyByDomain, findGroupCandidates } from './hubspot.js';
import { decideOwnership } from './decision.js';
import { normalizeDomain, normalizeCompanyName } from './normalize.js';

// ponytail: capped at 3 queries (was 5) - this account's Firecrawl plan allows only
// 5 requests/minute TOTAL, and every search here shares that budget with the single
// extraction call above it. At ~13s of enforced spacing per request, each additional
// query costs ~13s of wall-clock time against Vercel's 60s function ceiling. Raise this
// back up if the Firecrawl plan or the function timeout increases.
const CORROBORATION_QUERIES = [
  { source: 'google', build: (name) => `"${name}" "dealer group" OR "parent company"` },
  { source: 'automotive_news', build: (name) => `"${name}" site:autonews.com` },
  { source: 'pr_newswire', build: (name) => `"${name}" site:prnewswire.com` },
];

// ponytail: regex-based mention mining is a best-effort text heuristic, not real NLP.
// Upgrade path if accuracy is insufficient: swap for an LLM extraction pass over search snippets.
const MENTION_PATTERNS = [
  /part of (?:the )?([A-Z][\w&'.-]+(?:\s+[A-Z][\w&'.-]+){0,3}?)\s+(?:Group|Auto Group|Automotive Group|Dealerships)/,
  /owned by ([A-Z][\w&'.-]+(?:\s+[A-Z][\w&'.-]+){0,3}?)[.,]/,
  /a (?:subsidiary|member|division) of (?:the )?([A-Z][\w&'.-]+(?:\s+[A-Z][\w&'.-]+){0,3}?)[.,]/,
];

function mineGroupMention(text) {
  if (!text) return null;
  for (const pattern of MENTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

async function corroborate(companyName, candidateGroupName) {
  // Dispatched concurrently, but firecrawl.js's request gate still spaces the actual HTTP
  // calls ~13s apart underneath - Promise.all here is about code simplicity, not real
  // parallelism against Firecrawl's rate limit.
  const perQuery = await Promise.all(
    CORROBORATION_QUERIES.map(async ({ source, build }) => {
      try {
        const results = await searchWeb(build(companyName), 3);
        return results
          .map((r) => {
            const text = `${r.title || ''} ${r.description || ''}`;
            const mentioned = candidateGroupName
              ? normalizeCompanyName(text).includes(normalizeCompanyName(candidateGroupName))
                ? candidateGroupName
                : mineGroupMention(text)
              : mineGroupMention(text);
            return mentioned ? { source, url: r.url, mentionedGroup: mentioned } : null;
          })
          .filter(Boolean);
      } catch {
        return [];
      }
    })
  );
  return perQuery.flat();
}

export async function processDomain(rawDomain) {
  const domain = normalizeDomain(rawDomain);
  if (!domain) {
    return { domain: rawDomain, recommendation: 'REVIEW', confidence: 0, reason: 'Empty or invalid domain.', sources: [], evidence: [] };
  }

  const sources = [];
  try {
    // Homepage only - see the comment on extractOwnership() for why (the old multi-page
    // /v1/extract batch is dead; /v2/scrape is single-URL and the account's 5 req/min
    // limit doesn't allow calling it once per candidate page).
    const [officialSiteData, hubspotCompany] = await Promise.all([
      extractOwnership(`https://${domain}`),
      findCompanyByDomain(domain).catch(() => null),
    ]);
    sources.push(`https://${domain}`);

    const companyName = officialSiteData?.company_name || hubspotCompany?.properties?.name || domain;
    const candidateGroupName = officialSiteData?.dealer_group || officialSiteData?.parent_company || null;

    const corroboratingSources = await corroborate(companyName, candidateGroupName);
    sources.push(...corroboratingSources.map((s) => s.url).filter(Boolean));

    // If the site itself is silent on ownership, fall back to a name mined from search results.
    const effectiveCandidate = candidateGroupName || corroboratingSources[0]?.mentionedGroup || null;
    const hubspotCandidates = effectiveCandidate ? await findGroupCandidates(normalizeCompanyName(effectiveCandidate)).catch(() => []) : [];

    const decision = decideOwnership({
      officialSite: { ...officialSiteData, dealer_group: effectiveCandidate, parent_company: undefined },
      corroboratingSources,
      hubspotCandidates,
    });

    return {
      domain,
      company_name: companyName,
      company_record_id: hubspotCompany?.id || null,
      dealer_group: decision.dealer_group,
      hubspot_group_found: decision.hubspot_group_found,
      hubspot_group_record_id: decision.hubspot_group_record_id,
      recommendation: decision.recommendation,
      confidence: decision.confidence,
      reason: decision.reason,
      sources: [...new Set(sources)],
      evidence: decision.evidence,
    };
  } catch (err) {
    return {
      domain,
      company_name: null,
      company_record_id: null,
      dealer_group: null,
      hubspot_group_found: false,
      hubspot_group_record_id: null,
      recommendation: 'REVIEW',
      confidence: 0,
      reason: `Processing failed: ${err.message}`,
      sources,
      evidence: [],
      error: true,
    };
  }
}
