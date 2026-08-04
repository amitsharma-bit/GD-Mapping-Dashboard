import { extractOwnership, searchWeb } from './firecrawl.js';
import { findCompanyByDomain, findGroupCandidates } from './hubspot.js';
import { decideOwnership } from './decision.js';
import { normalizeDomain, normalizeCompanyName } from './normalize.js';

const CORROBORATION_QUERIES = [
  { source: 'google', build: (name) => `"${name}" "dealer group" OR "parent company"` },
  { source: 'linkedin', build: (name) => `"${name}" site:linkedin.com/company` },
  { source: 'pr_newswire', build: (name) => `"${name}" site:prnewswire.com` },
  { source: 'business_wire', build: (name) => `"${name}" site:businesswire.com` },
  { source: 'automotive_news', build: (name) => `"${name}" site:autonews.com` },
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
  // Run all queries concurrently - sequential took 5x as long and risked the
  // Vercel function's time budget on its own.
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
    // Target the pages the spec calls out explicitly (About/Locations/Leadership/Contact/Press/
    // Privacy). Capped at 10 - Firecrawl's /v1/extract rejects more than 10 URLs per request.
    const candidatePaths = ['', 'about', 'about-us', 'locations', 'leadership', 'our-team', 'contact', 'press', 'news', 'privacy-policy'];
    const targetUrls = candidatePaths.map((p) => `https://${domain}/${p}`);

    const [officialSiteData, hubspotCompany] = await Promise.all([
      extractOwnership(targetUrls),
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
