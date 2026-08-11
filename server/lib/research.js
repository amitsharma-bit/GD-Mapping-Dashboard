import Anthropic from '@anthropic-ai/sdk';

// Real web research via Claude's server-side web_search / web_fetch tools - this is
// the direct replacement for the old Firecrawl-based extraction+search pipeline. No
// Firecrawl involved anywhere in this file. Claude runs its own iterative research
// loop server-side (multiple searches per single request); we only drive the
// pause_turn resume loop and force a structured final answer via a client-side tool
// call, so we never have to regex-mine search snippets for a group name the way
// pipeline.js used to.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

// Quick/Standard/Deep map to search budget + reasoning effort. Deep is intentionally
// the only mode allowed to risk Vercel's 60s function ceiling - it's an explicit,
// user-triggered escalation for when Standard's confidence came back low, not the
// default path, so an occasional timeout there is an acceptable tradeoff.
const MODE_CONFIG = {
  quick: { effort: 'low', maxSearchUses: 3, maxFetchUses: 1, maxTokens: 8000, maxRounds: 2 },
  standard: { effort: 'medium', maxSearchUses: 6, maxFetchUses: 2, maxTokens: 12000, maxRounds: 3 },
  deep: { effort: 'high', maxSearchUses: 14, maxFetchUses: 4, maxTokens: 20000, maxRounds: 6 },
};

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    verified_company_name: { type: ['string', 'null'], description: 'The dealership\'s actual/official business name, confirmed via research. Null if it could not be confirmed at all.' },
    name_difference_reason: { type: ['string', 'null'], description: 'If verified_company_name differs from the name supplied in the request, explain why (e.g. "the site does business as X but is legally registered as Y"). Null if there is no difference or none was found.' },
    brand_oem: { type: ['string', 'null'], description: 'The vehicle brand(s)/OEM this dealership carries, if determined.' },
    owner: { type: ['string', 'null'] },
    dealer_principal: { type: ['string', 'null'] },
    president_ceo: { type: ['string', 'null'], description: 'President, CEO, or Managing Partner, whichever is findable.' },
    parent_company: { type: ['string', 'null'], description: 'The corporate/holding entity, if distinct from the dealership group brand name.' },
    dealer_group: { type: ['string', 'null'], description: 'The CURRENT dealership group / automotive group this dealership operates under. This is the group name, not a person\'s name, unless the dealership is genuinely solo/independent with no group affiliation.' },
    previous_ownership: { type: ['string', 'null'], description: 'The group/owner this dealership belonged to BEFORE its most recent ownership change, if an acquisition or ownership change was found.' },
    acquisition: {
      type: ['object', 'null'],
      description: 'Details of the most recent acquisition/ownership change affecting this dealership, if any was found.',
      properties: {
        previous_group: { type: ['string', 'null'] },
        current_group: { type: ['string', 'null'] },
        acquirer: { type: ['string', 'null'] },
        seller: { type: ['string', 'null'] },
        date: { type: ['string', 'null'], description: 'Date or approximate date/year of the acquisition.' },
      },
    },
    related_dealerships: {
      type: 'array',
      items: { type: 'string' },
      description: 'Other dealerships confirmed (via the group\'s own site or other evidence) to be owned by the same group/owner.',
    },
    official_group_website: { type: ['string', 'null'], description: 'The dealership GROUP\'s own official corporate website URL (not the individual dealership\'s site), if found.' },
    group_site_confirms_dealership: {
      type: 'boolean',
      description: 'True ONLY if you used web_fetch to actually visit official_group_website and confirmed this specific dealership (by name or domain) is listed there as one of its locations.',
    },
    independently_owned: {
      type: 'boolean',
      description: 'True only if, after real research (not merely because the dealership\'s own site is silent about ownership), you found no evidence this dealership is part of any group, and no plausible group candidate ever surfaced.',
    },
    independence_reason: { type: ['string', 'null'], description: 'If independently_owned is true, the evidence that supports that conclusion (not just absence of a group mention).' },
    conflict_detected: { type: 'boolean', description: 'True if different sources disagree about current ownership/group.' },
    conflicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim_a: { type: 'string' },
          source_a: { type: 'string', description: 'URL supporting claim_a.' },
          claim_b: { type: 'string' },
          source_b: { type: 'string', description: 'URL supporting claim_b.' },
          possible_reason: { type: 'string', description: 'e.g. "source_b is outdated; a more recent acquisition supersedes it".' },
        },
      },
    },
    evidence: {
      type: 'array',
      description: 'Every piece of evidence that supports dealer_group, owner, or the acquisition. Every entry MUST cite a real URL you actually retrieved via web_search or web_fetch in this session - never a URL you did not see in a tool result.',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string', description: 'The specific fact this evidence supports, e.g. "Coconut Point Ford is part of ABC Automotive Group".' },
          source_tier: { type: 'string', enum: ['tier1', 'tier2', 'tier3'], description: 'tier1 = official dealership/group site, OEM locator, press release, gov corporate record, SEC filing. tier2 = Automotive News/trade press/PR Newswire/Business Wire/reputable local news. tier3 = LinkedIn/DealerRater/directories/other.' },
          url: { type: 'string' },
          title: { type: ['string', 'null'] },
        },
        required: ['claim', 'source_tier', 'url'],
      },
    },
    sources: { type: 'array', items: { type: 'string' }, description: 'All source URLs consulted during research.' },
    search_queries: { type: 'array', items: { type: 'string' }, description: 'The actual search queries you ran, in order, including follow-up queries built from earlier discoveries.' },
    reasoning_summary: { type: 'string', description: '2-4 sentence plain-English summary of how you reached your conclusion, written for a human reviewer.' },
  },
  required: ['verified_company_name', 'dealer_group', 'independently_owned', 'conflict_detected', 'evidence', 'sources', 'search_queries', 'reasoning_summary'],
};

const SUBMIT_TOOL = {
  name: 'submit_research_report',
  description:
    'Submit your final, evidence-backed research findings on this dealership\'s current ownership. Call this exactly once, only after you have finished researching. Do not answer in plain text - your final answer must be this tool call.',
  input_schema: REPORT_SCHEMA,
};

function buildSystemPrompt() {
  return `You are an experienced automotive industry researcher determining the CURRENT corporate ownership of a car dealership.

Rules you must follow:
1. Never guess, never fabricate a dealership group, owner, or acquisition. Every claim in your final report must trace to a real source you retrieved with web_search or web_fetch in this session.
2. Do NOT conclude "independent" just because the dealership's own website doesn't mention a parent group - most dealerships don't self-disclose ownership. Only report independently_owned=true after you've actually searched for ownership/acquisition/owner information externally and found nothing, or found explicit confirmation of independent ownership.
3. Research iteratively. Start with a few targeted searches based on the company name, domain, city, and state you're given. Use what you learn to run more targeted follow-up searches: if you find an owner's name, search for that person's other dealerships; if you find a candidate group name, search for that group's other locations, its official site, and any recent acquisitions.
4. Prioritize sources: official dealership/group websites, OEM dealer locators, press releases, and SEC/gov corporate records are most reliable (tier1); Automotive News, PR Newswire, Business Wire, dealer associations, and reputable local news are next (tier2); LinkedIn, DealerRater, and general directories are least reliable (tier3). Prefer multiple independent sources over one.
5. If you identify a candidate group, try to find that group's own official website (web_fetch it) and check whether this specific dealership is listed there. This is the strongest possible confirmation - set group_site_confirms_dealership=true only if you actually did this and it confirmed the listing.
6. Always check for acquisitions or ownership changes. If sources disagree on current ownership, prefer the most recent, most reliable evidence, and report the disagreement in conflicts rather than silently picking one side.
7. Distinguish an individual owner's name from the dealership GROUP brand name - dealer_group should be the group's actual name (e.g. "ABC Automotive Group"), not the owner's personal name, unless the operation is genuinely a small solo independent.
8. Use every piece of context you're given (company name, domain, city, state) to disambiguate - there may be multiple businesses with similar names.
9. When you are done, call submit_research_report exactly once with your complete findings. Do not submit partial findings while you still intend to search more.`;
}

function buildUserPrompt({ companyName, domain, city, state }) {
  const lines = [
    `Research the current corporate ownership and dealership group of this business:`,
    '',
    `Company Domain (primary identifier): ${domain}`,
  ];
  if (companyName) lines.push(`Company Name (as provided): ${companyName}`);
  if (city) lines.push(`City: ${city}`);
  if (state) lines.push(`State: ${state}`);
  lines.push(
    '',
    'First verify you have the right business (the supplied name may be shortened or slightly different from the official registered name - that is not an error, investigate and reconcile it). Then determine its current owner, dealer principal, parent company, and dealership group, checking for any acquisition or ownership change. Investigate whether the owner/group runs other dealerships. Then call submit_research_report.'
  );
  return lines.join('\n');
}

// Ground-truth URLs actually returned by the search/fetch tools during this session -
// used to sanity-check the model's self-reported evidence/sources rather than trusting
// them blindly. Deliberately loose (regex over the serialized block) instead of coding
// to an exact nested result schema, since the point is "did this URL really come back
// from a tool call", not full type fidelity.
function extractUrlsFromBlock(block) {
  const text = JSON.stringify(block);
  const matches = text.match(/https?:\/\/[^\s"'\\]+/g) || [];
  return matches.map((u) => u.replace(/[),.]+$/, ''));
}

function collectGroundTruth(allBlocks) {
  const urls = new Set();
  const queries = [];
  for (const block of allBlocks) {
    if (block.type === 'web_search_tool_result' || block.type === 'web_fetch_tool_result') {
      for (const url of extractUrlsFromBlock(block)) urls.add(url);
    }
    if (block.type === 'server_tool_use' && block.name === 'web_search' && block.input?.query) {
      queries.push(block.input.query);
    }
    if (block.type === 'server_tool_use' && block.name === 'web_fetch' && block.input?.url) {
      urls.add(block.input.url);
    }
  }
  return { urls, queries };
}

function sanitizeReport(rawInput, groundTruth) {
  const report = rawInput && typeof rawInput === 'object' ? rawInput : {};
  const evidence = Array.isArray(report.evidence) ? report.evidence : [];
  const verifiedEvidence = evidence.filter((e) => e && e.url && groundTruth.urls.has(e.url));
  const droppedEvidenceCount = evidence.length - verifiedEvidence.length;

  const reportedSources = Array.isArray(report.sources) ? report.sources : [];
  const verifiedSources = [...new Set(reportedSources.filter((u) => groundTruth.urls.has(u)))];

  return {
    verified_company_name: report.verified_company_name || null,
    name_difference_reason: report.name_difference_reason || null,
    brand_oem: report.brand_oem || null,
    owner: report.owner || null,
    dealer_principal: report.dealer_principal || null,
    president_ceo: report.president_ceo || null,
    parent_company: report.parent_company || null,
    dealer_group: report.dealer_group || null,
    previous_ownership: report.previous_ownership || null,
    acquisition: report.acquisition && (report.acquisition.current_group || report.acquisition.previous_group || report.acquisition.acquirer)
      ? report.acquisition
      : null,
    related_dealerships: Array.isArray(report.related_dealerships) ? report.related_dealerships : [],
    official_group_website: report.official_group_website || null,
    group_site_confirms_dealership: Boolean(report.group_site_confirms_dealership),
    independently_owned: Boolean(report.independently_owned),
    independence_reason: report.independence_reason || null,
    conflict_detected: Boolean(report.conflict_detected),
    conflicts: Array.isArray(report.conflicts) ? report.conflicts : [],
    evidence: verifiedEvidence,
    unverifiable_evidence_dropped: droppedEvidenceCount,
    sources: verifiedSources,
    search_queries: groundTruth.queries.length ? groundTruth.queries : (Array.isArray(report.search_queries) ? report.search_queries : []),
    reasoning_summary: report.reasoning_summary || '',
  };
}

export async function researchCompany({ companyName, domain, city, state, mode = 'standard' }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const config = MODE_CONFIG[mode] || MODE_CONFIG.standard;
  const client = new Anthropic({ apiKey });

  const tools = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: config.maxSearchUses },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: config.maxFetchUses },
    { type: 'custom', ...SUBMIT_TOOL },
  ];

  const messages = [{ role: 'user', content: buildUserPrompt({ companyName, domain, city, state }) }];
  const allBlocks = [];
  let response;
  let round = 0;

  // web_search/web_fetch are server-side tools: Claude's own multi-query research loop
  // happens inside a single request. pause_turn only fires if that internal loop hits
  // its iteration ceiling before Claude is done - we resume by resending, per Anthropic's
  // documented pattern (no synthetic "continue" message, it auto-detects the trailing
  // server_tool_use block). This is NOT a client-driven query-by-query loop like the old
  // Firecrawl pipeline had to build by hand.
  for (;;) {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: config.maxTokens,
      system: buildSystemPrompt(),
      messages,
      tools,
      output_config: { effort: config.effort },
    });
    allBlocks.push(...response.content);

    if (response.stop_reason === 'pause_turn') {
      round += 1;
      if (round > config.maxRounds) break;
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    break;
  }

  if (response.stop_reason === 'refusal') {
    return { error: true, reason: 'Research request was declined by safety filters.', mode };
  }

  const submitBlock = response.content.find((b) => b.type === 'tool_use' && b.name === 'submit_research_report');
  const groundTruth = collectGroundTruth(allBlocks);

  if (!submitBlock) {
    return {
      error: true,
      reason: `Model did not return a structured report (stop_reason: ${response.stop_reason}).`,
      mode,
      sources: [...groundTruth.urls],
      search_queries: groundTruth.queries,
    };
  }

  const report = sanitizeReport(submitBlock.input, groundTruth);
  return { error: false, mode, ...report };
}
