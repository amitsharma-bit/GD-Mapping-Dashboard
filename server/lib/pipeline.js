import { researchCompany } from './research.js';
import { findCompanyByDomain, findGroupCandidates } from './hubspot.js';
import { decideMapping } from './decision.js';
import { normalizeDomain, normalizeCompanyName, namesLikelyMatch } from './normalize.js';

function baseResult(overrides = {}) {
  return {
    input_company_name: null,
    input_domain: null,
    input_city: null,
    input_state: null,
    domain: null,
    status: 'FAILED',
    verified_company_name: null,
    name_difference_reason: null,
    brand_oem: null,
    owner: null,
    dealer_principal: null,
    president_ceo: null,
    parent_company: null,
    dealer_group: null,
    previous_ownership: null,
    acquisition: null,
    related_dealerships: [],
    official_group_website: null,
    independently_owned: false,
    independence_reason: null,
    conflict_detected: false,
    conflicts: [],
    company_record_id: null,
    hubspot_group_name: null,
    hubspot_group_record_id: null,
    match_type: 'NO_MATCH',
    match_confidence: 0,
    recommendation: 'REVIEW',
    confidence: 0,
    reason: '',
    evidence: [],
    sources: [],
    search_queries: [],
    research_mode: null,
    research_timestamp: null,
    error: false,
    ...overrides,
  };
}

// Company Name + City + State come in from bulk paste/CSV with a lot of header-name
// variance (handled client-side in parseFile.js) - by the time a record reaches here
// it's already normalized to these four fields. Domain is the primary identifier and
// the only strictly required one, per the input spec.
export async function processCompany({ companyName, domain: rawDomain, city, state, mode = 'standard' } = {}) {
  const domain = normalizeDomain(rawDomain);
  const input = { input_company_name: companyName || null, input_domain: rawDomain || null, input_city: city || null, input_state: state || null };

  if (!domain) {
    return baseResult({ ...input, status: 'INVALID', reason: 'Missing or invalid Company Domain.', error: true });
  }

  const partialInput = !companyName || !city || !state;

  try {
    const hubspotCompany = await findCompanyByDomain(domain).catch(() => null);

    // Step 0 (preserved from the original pipeline, unchanged in spirit): if HubSpot's
    // OWN record for this company already carries a dealership_group_name, that is
    // direct first-party evidence and there is nothing to re-derive from external
    // research - skip straight to a HubSpot-groups lookup and return.
    const existingGroupName = hubspotCompany?.properties?.dealership_group_name || null;
    if (existingGroupName) {
      const groupCandidates = await findGroupCandidates(normalizeCompanyName(existingGroupName)).catch(() => []);
      const groupRecord =
        groupCandidates.find((c) => c.properties?.name === c.properties?.dealership_group_name && namesLikelyMatch(c.properties.name, existingGroupName)) ||
        groupCandidates.find((c) => namesLikelyMatch(c.properties?.dealership_group_name || '', existingGroupName));

      return baseResult({
        ...input,
        domain,
        status: 'COMPLETED',
        verified_company_name: hubspotCompany.properties?.name || companyName || null,
        dealer_group: existingGroupName,
        company_record_id: hubspotCompany.id,
        hubspot_group_name: groupRecord?.properties?.dealership_group_name || groupRecord?.properties?.name || null,
        hubspot_group_record_id: groupRecord?.id || null,
        match_type: groupRecord ? 'EXACT_MATCH' : 'NO_MATCH',
        match_confidence: groupRecord ? 100 : 0,
        recommendation: groupRecord ? 'MAP' : 'REVIEW',
        confidence: 100,
        reason: groupRecord
          ? `Already associated with "${existingGroupName}" in HubSpot; matching group record found.`
          : `HubSpot already records this company's dealership group as "${existingGroupName}", but no separate group record was found under that name - verify manually.`,
        evidence: [`HubSpot Company record already has dealership_group_name = "${existingGroupName}"`],
        sources: [`https://${domain}`],
        research_mode: 'hubspot_shortcircuit',
        research_timestamp: new Date().toISOString(),
      });
    }

    const research = await researchCompany({ companyName, domain, city, state, mode });

    if (research.error) {
      return baseResult({
        ...input,
        domain,
        status: partialInput ? 'PARTIAL_INPUT' : 'FAILED',
        company_record_id: hubspotCompany?.id || null,
        reason: research.reason || 'Research failed.',
        sources: research.sources || [],
        search_queries: research.search_queries || [],
        research_mode: mode,
        research_timestamp: new Date().toISOString(),
        error: true,
      });
    }

    const candidateGroupName = research.dealer_group || research.parent_company || null;
    const hubspotCandidates = candidateGroupName
      ? await findGroupCandidates(normalizeCompanyName(candidateGroupName)).catch(() => [])
      : [];

    const decision = decideMapping({ research, hubspotCandidates });

    return baseResult({
      ...input,
      domain,
      status: 'COMPLETED',
      verified_company_name: research.verified_company_name || companyName || null,
      name_difference_reason: research.name_difference_reason,
      brand_oem: research.brand_oem,
      owner: research.owner,
      dealer_principal: research.dealer_principal,
      president_ceo: research.president_ceo,
      parent_company: research.parent_company,
      dealer_group: decision.dealer_group,
      previous_ownership: research.previous_ownership,
      acquisition: research.acquisition,
      related_dealerships: research.related_dealerships || [],
      official_group_website: research.official_group_website,
      independently_owned: research.independently_owned,
      independence_reason: research.independence_reason,
      conflict_detected: research.conflict_detected,
      conflicts: research.conflicts || [],
      company_record_id: hubspotCompany?.id || null,
      hubspot_group_name: decision.hubspot_group_name,
      hubspot_group_record_id: decision.hubspot_group_record_id,
      match_type: decision.match_type,
      match_confidence: decision.match_confidence,
      recommendation: decision.recommendation,
      confidence: decision.confidence,
      reason: decision.reason,
      evidence: decision.evidence,
      sources: research.sources || [],
      search_queries: research.search_queries || [],
      research_mode: mode,
      research_timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return baseResult({ ...input, domain, status: 'FAILED', reason: `Processing failed: ${err.message}`, error: true });
  }
}
