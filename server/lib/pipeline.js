import { extractOwnership, searchWeb, scrapePage } from './firecrawl.js';
import { findCompanyByDomain, findGroupCandidates } from './hubspot.js';
import { decideOwnership } from './decision.js';
import { normalizeDomain, normalizeCompanyName, namesLikelyMatch } from './normalize.js';

// ponytail: capped at 2 queries (was 3, then briefly 5) - this account's Firecrawl plan
// allows only 5 requests/minute TOTAL, shared with the single extraction call above and
// the conditional owner-fallback/group-verification calls below. Each combines what used
// to be 2-3 separate site-scoped queries into one OR'd query, covering the same breadth of
// sources (Automotive News/PR Newswire/Business Wire) for one request instead of three.
const CORROBORATION_QUERIES = [
  { source: 'ownership', build: (name) => `"${name}" ("dealer group" OR "auto group" OR "parent company" OR "owned by" OR acquired OR acquisition OR "who owns")` },
  { source: 'trade_press', build: (name) => `"${name}" (site:autonews.com OR site:prnewswire.com OR site:businesswire.com)` },
];

// ponytail: regex-based mention mining is a best-effort text heuristic, not real NLP -
// broadened substantially (was 3 rigid patterns) to catch how ownership is actually phrased
// in real search snippets: acquisition announcements, executive-title sentences, "X family
// of dealerships", etc. Upgrade path if accuracy is still insufficient: an LLM pass over
// search snippets instead of regex.
const MENTION_PATTERNS = [
  /part of (?:the )?([A-Z][\w&'.-]+(?:\s+[A-Z][\w&'.-]+){0,3}?)\s+(?:Group|Auto Group|Automotive Group|Dealerships)/,
  /owned by ([A-Z][\w&'.-]+(?:\s+[A-Z][\w&'.-]+){0,3}?)[.,]/,
  /a (?:subsidiary|member|division) of (?:the )?([A-Z][\w&'.-]+(?:\s+[A-Z][\w&'.-]+){0,3}?)[.,]/,
  /(?:^|[.,]\s*)([A-Z][\w&'.-]+(?:\s+[A-Z][\w&'.-]+){0,3}?)\s+(?:Auto Group|Automotive Group|Dealerships) (?:acquir|purchas|announc|complet)/,
  /([A-Z][\w&'.-]+(?:\s+[A-Z][\w&'.-]+){0,3}?)\s+(?:Auto Group|Automotive Group)(?:'s| has| today| announced)/,
  /(?:acquired|acquires|purchased|joins|joined) (?:by )?([A-Z][\w&'.-]+(?:\s+[A-Z][\w&'.-]+){0,3}?)\s+(?:Group|Auto Group|Automotive Group)/,
  /(?:President|CEO|Owner|Dealer Principal|Chairman|Managing Partner) of ([A-Z][\w&'.-]+(?:\s+[A-Z][\w&'.-]+){0,3}?)\s+(?:Group|Auto Group|Automotive Group)/,
  /(?:a|the) ([A-Z][\w&'.-]+(?:\s+[A-Z][\w&'.-]+){0,3}?)\s+(?:Group|Auto Group|Automotive Group) dealership/,
  /member of the ([A-Z][\w&'.-]+(?:\s+[A-Z][\w&'.-]+){0,3}?)\s+family of dealerships/i,
];

function mineGroupMention(text) {
  if (!text) return null;
  for (const pattern of MENTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

async function runQueries(queries, name) {
  const perQuery = await Promise.all(
    queries.map(async ({ source, build }) => {
      try {
        const results = await searchWeb(build(name), 3);
        return results.map((r) => ({ source, url: r.url, title: r.title, description: r.description }));
      } catch {
        return [];
      }
    })
  );
  return perQuery.flat();
}

function mineMentions(results, candidateGroupName) {
  return results
    .map(({ source, url, title, description }) => {
      const text = `${title || ''} ${description || ''}`;
      const mentioned = candidateGroupName
        ? normalizeCompanyName(text).includes(normalizeCompanyName(candidateGroupName))
          ? candidateGroupName
          : mineGroupMention(text)
        : mineGroupMention(text);
      return mentioned ? { source, url, mentionedGroup: mentioned } : null;
    })
    .filter(Boolean);
}

// Sites these searches routinely surface that are never themselves "the group's official
// website" - excluded so the opportunistic site-verification step below doesn't waste its
// one shot trying to verify against a press-wire or directory listing.
const NON_CORPORATE_HOSTS = [
  'autonews.com', 'prnewswire.com', 'businesswire.com', 'linkedin.com', 'facebook.com',
  'twitter.com', 'x.com', 'instagram.com', 'youtube.com', 'dealerrater.com',
  'wikipedia.org', 'google.com', 'yelp.com', 'bbb.org', 'glassdoor.com', 'indeed.com',
  'mapquest.com', 'yellowpages.com', 'cars.com', 'cargurus.com', 'edmunds.com', 'autotrader.com',
];

function registrableName(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const parts = host.split('.');
    return { host, name: parts.length >= 2 ? parts[parts.length - 2] : host };
  } catch {
    return null;
  }
}

// Mimics "go find the group's own site" without spending a dedicated search query on it -
// scans URLs already fetched for corroboration for one whose domain plausibly IS the
// group (e.g. "lithiamotors.com" for "Lithia Motors"), skipping known non-corporate hosts.
function findLikelyGroupSite(allResults, groupName) {
  for (const { url } of allResults) {
    if (!url) continue;
    const reg = registrableName(url);
    if (!reg) continue;
    if (NON_CORPORATE_HOSTS.some((h) => reg.host === h || reg.host.endsWith(`.${h}`))) continue;
    if (namesLikelyMatch(reg.name, groupName)) return `https://${reg.host}`;
  }
  return null;
}

// Visits the candidate group's own site once and checks whether THIS dealership (by name
// or domain) is actually listed there - the closest affordable approximation of "visit the
// parent group's website and confirm the dealership is one of its locations." A failed/
// inconclusive check is never treated as evidence AGAINST ownership (our ability to verify
// is itself imperfect) - it only ever adds confidence, never removes it.
async function verifyAgainstGroupSite(groupSiteUrl, companyName, domain) {
  try {
    const page = await scrapePage(groupSiteUrl);
    if (!page) return { verified: false, url: groupSiteUrl };
    const haystack = `${page.markdown || ''} ${(page.links || []).join(' ')}`.toLowerCase();
    if (domain && haystack.includes(domain.toLowerCase())) return { verified: true, url: groupSiteUrl };
    const nameTokens = normalizeCompanyName(companyName).split(' ').filter((t) => t.length > 2);
    const nameHit = nameTokens.length > 0 && nameTokens.every((t) => haystack.includes(t));
    return { verified: nameHit, url: groupSiteUrl };
  } catch {
    return { verified: false, url: groupSiteUrl };
  }
}

function emptyResult(domain, overrides = {}) {
  return {
    domain,
    company_name: null,
    company_record_id: null,
    dealer_group: null,
    hubspot_group_found: false,
    hubspot_group_record_id: null,
    recommendation: 'REVIEW',
    confidence: 0,
    reason: '',
    owner: null,
    dealer_principal: null,
    corporate_website: null,
    sources: [],
    evidence: [],
    ...overrides,
  };
}

export async function processDomain(rawDomain) {
  const domain = normalizeDomain(rawDomain);
  if (!domain) {
    return emptyResult(rawDomain, { reason: 'Empty or invalid domain.' });
  }

  const sources = [`https://${domain}`];
  try {
    const [officialSiteData, hubspotCompany] = await Promise.all([
      extractOwnership(`https://${domain}`),
      findCompanyByDomain(domain).catch(() => null),
    ]);

    const companyName = officialSiteData?.company_name || hubspotCompany?.properties?.name || domain;
    const owner = officialSiteData?.owner || null;
    const dealerPrincipal = officialSiteData?.dealer_principal || null;

    // The core fix: if HubSpot's OWN record for this company already has a dealership
    // group set, that is direct, authoritative evidence - there is nothing to re-derive
    // from external research, and skipping straight to it also saves the whole research
    // budget for domains that genuinely need it. Previously this property was fetched by
    // findCompanyByDomain() but never read, so an already-correctly-tagged company would
    // still get sent through external research and reported unmapped if that research
    // (which requires the *website* to self-disclose ownership) came up empty.
    const existingGroupName = hubspotCompany?.properties?.dealership_group_name || null;
    if (existingGroupName) {
      const groupCandidates = await findGroupCandidates(normalizeCompanyName(existingGroupName)).catch(() => []);
      const groupRecord =
        groupCandidates.find((c) => c.properties?.name === c.properties?.dealership_group_name && namesLikelyMatch(c.properties.name, existingGroupName)) ||
        groupCandidates.find((c) => namesLikelyMatch(c.properties?.dealership_group_name || '', existingGroupName));

      return emptyResult(domain, {
        company_name: companyName,
        company_record_id: hubspotCompany.id,
        dealer_group: existingGroupName,
        hubspot_group_found: Boolean(groupRecord),
        hubspot_group_record_id: groupRecord?.id || null,
        recommendation: groupRecord ? 'MAP' : 'REVIEW',
        confidence: 100,
        reason: groupRecord
          ? `Already associated with "${existingGroupName}" in HubSpot; matching group record found.`
          : `HubSpot already records this company's dealership group as "${existingGroupName}", but no separate group record was found under that name — verify manually.`,
        owner,
        dealer_principal: dealerPrincipal,
        sources,
        evidence: [`HubSpot Company record already has dealership_group_name = "${existingGroupName}"`],
      });
    }

    const candidateGroupName = officialSiteData?.dealer_group || officialSiteData?.parent_company || null;

    const primaryResults = await runQueries(CORROBORATION_QUERIES, companyName);
    let corroboratingSources = mineMentions(primaryResults, candidateGroupName);
    let allResults = primaryResults;
    sources.push(...primaryResults.map((r) => r.url).filter(Boolean));

    // Tracked separately from the candidate string itself because it feeds decision.js's
    // base confidence: the site naming its own parent is first-party and more reliable
    // than a name mined out of a third-party search snippet, which is in turn more
    // reliable than a name found only by following the owner's name (two inferential hops
    // removed from the dealership itself).
    let effectiveCandidate = candidateGroupName;
    let candidateSource = candidateGroupName ? 'official_site' : null;
    if (!effectiveCandidate) {
      effectiveCandidate = corroboratingSources[0]?.mentionedGroup || null;
      if (effectiveCandidate) candidateSource = 'search_mined';
    }

    // Owner-name fallback: only when the site and both corroboration queries came up with
    // nothing at all, and only when we actually have a person's name to search with -
    // approximates "does this owner run other dealerships under a known group name"
    // without the full multi-domain research graph the ideal workflow would want (that
    // would need searching for and re-processing each of the owner's OTHER dealerships in
    // turn, which is not affordable in one request under this rate limit).
    if (!effectiveCandidate && (owner || dealerPrincipal)) {
      const ownerResults = await runQueries(
        [{ source: 'owner', build: (n) => `"${n}" ("auto group" OR dealerships OR "dealer group")` }],
        owner || dealerPrincipal
      );
      const ownerMentions = mineMentions(ownerResults, null);
      corroboratingSources = corroboratingSources.concat(ownerMentions);
      allResults = allResults.concat(ownerResults);
      sources.push(...ownerResults.map((r) => r.url).filter(Boolean));
      effectiveCandidate = ownerMentions[0]?.mentionedGroup || null;
      if (effectiveCandidate) candidateSource = 'owner_fallback';
    }

    // Group-site verification: only when we have a candidate to verify, and only spends
    // the request if we can plausibly identify the group's own site from URLs already
    // fetched above (never a dedicated search - see findLikelyGroupSite). Approximates
    // "visit the parent group's official website and confirm this dealership is listed."
    let verification = null;
    let corporateWebsite = null;
    if (effectiveCandidate) {
      const groupSiteUrl = findLikelyGroupSite(allResults, effectiveCandidate);
      if (groupSiteUrl) {
        verification = await verifyAgainstGroupSite(groupSiteUrl, companyName, domain);
        if (verification.verified) {
          corporateWebsite = groupSiteUrl;
          sources.push(groupSiteUrl);
        }
      }
    }

    const hubspotCandidates = effectiveCandidate
      ? await findGroupCandidates(normalizeCompanyName(effectiveCandidate)).catch(() => [])
      : [];

    const decision = decideOwnership({
      officialSite: { ...officialSiteData, dealer_group: effectiveCandidate, parent_company: undefined },
      candidateSource,
      corroboratingSources,
      hubspotCandidates,
      verifiedByGroupSite: Boolean(verification?.verified),
    });

    return emptyResult(domain, {
      company_name: companyName,
      company_record_id: hubspotCompany?.id || null,
      dealer_group: decision.dealer_group,
      hubspot_group_found: decision.hubspot_group_found,
      hubspot_group_record_id: decision.hubspot_group_record_id,
      recommendation: decision.recommendation,
      confidence: decision.confidence,
      reason: decision.reason,
      owner,
      dealer_principal: dealerPrincipal,
      corporate_website: corporateWebsite,
      sources: [...new Set(sources)],
      evidence: decision.evidence,
    });
  } catch (err) {
    return emptyResult(domain, { reason: `Processing failed: ${err.message}`, sources, error: true });
  }
}
