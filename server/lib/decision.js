import { namesLikelyMatch, normalizeCompanyName } from './normalize.js';

// Evidence-based confidence engine (rewritten for the Claude + web_search research
// pipeline). Confidence is never taken from the model's own self-assessment - it's
// computed here, deterministically, from the tier/count of evidence the research
// step actually collected (and cross-verified against real tool-call URLs in
// research.js). This keeps the "never guess, never fabricate" rule enforceable in
// code rather than trusting the LLM's opinion of its own certainty.

const TIER1 = 'tier1';
const TIER2 = 'tier2';
const TIER3 = 'tier3';

// Classifies how a candidate dealership-group name relates to an existing HubSpot
// group record. `context.viaAcquisition`/`context.viaOwnership` let the caller mark a
// match that was found through the acquisition/ownership chain rather than name
// similarity, per the spec's ACQUISITION_MATCH / OWNERSHIP_MATCH categories.
export function classifyMatchType(candidateName, hubspotRecord, context = {}) {
  if (!candidateName || !hubspotRecord) return 'NO_MATCH';
  const storedGroupName = hubspotRecord.properties?.dealership_group_name || hubspotRecord.properties?.name || '';
  if (!storedGroupName) return 'NO_MATCH';

  const rawA = candidateName.trim().toLowerCase();
  const rawB = storedGroupName.trim().toLowerCase();
  if (rawA === rawB) return 'EXACT_MATCH';

  const normA = normalizeCompanyName(candidateName);
  const normB = normalizeCompanyName(storedGroupName);
  if (normA && normA === normB) return 'NORMALIZED_MATCH';

  if (!namesLikelyMatch(candidateName, storedGroupName)) return 'NO_MATCH';

  if (context.viaAcquisition) return 'ACQUISITION_MATCH';
  if (context.viaOwnership) return 'OWNERSHIP_MATCH';
  return 'ALIAS_MATCH';
}

// Finds the best HubSpot candidate for a group name among search results, preferring
// the record that represents the group itself (name === dealership_group_name) over
// an individual rooftop record that merely carries that group name as a property.
export function findBestHubSpotMatch(candidateName, hubspotCandidates = [], context = {}) {
  if (!candidateName) return { record: null, matchType: 'NO_MATCH' };
  const matches = hubspotCandidates
    .map((record) => ({ record, matchType: classifyMatchType(candidateName, record, context) }))
    .filter((m) => m.matchType !== 'NO_MATCH');
  if (!matches.length) return { record: null, matchType: 'NO_MATCH' };

  const rank = { EXACT_MATCH: 5, NORMALIZED_MATCH: 4, ACQUISITION_MATCH: 3, OWNERSHIP_MATCH: 3, ALIAS_MATCH: 2, POSSIBLE_MATCH: 1 };
  matches.sort((a, b) => (rank[b.matchType] || 0) - (rank[a.matchType] || 0));

  const groupRecord = matches.find((m) => m.record.properties?.name === m.record.properties?.dealership_group_name);
  return groupRecord || matches[0];
}

// Confidence table, evidence-driven (spec section 16):
//   100 - the group's own official site directly confirms this dealership is listed
//    95 - at least one tier1 source plus 2+ independent corroborating sources
//    90 - a tier1 or tier2 source, no independent corroboration yet
//    80 - 2+ independent (tier2/tier3) sources agree, no tier1 evidence
//    70 - exactly one corroborating source, otherwise probable but thin
// 50-69 - some evidence exists but it's too weak/conflicting to act on
//   <50 - never auto-map
function computeOwnershipConfidence({ candidateGroup, evidence, verifiedOnGroupSite, conflictDetected }) {
  if (!candidateGroup) return 0;
  if (conflictDetected) return 35;

  // Every evidence entry that survived research.js's URL cross-check is assumed to be
  // about the reported candidate group (the model was instructed to only cite
  // evidence supporting dealer_group) - so we simply tier-bucket what's left.
  const supporting = evidence.filter((e) => e.source_tier);
  const tier1Count = supporting.filter((e) => e.source_tier === TIER1).length;
  const tier2Count = supporting.filter((e) => e.source_tier === TIER2).length;
  const tier3Count = supporting.filter((e) => e.source_tier === TIER3).length;
  const independentCount = supporting.length;

  if (verifiedOnGroupSite) return 100;
  if (tier1Count >= 1 && independentCount >= 2) return 95;
  if (tier1Count >= 1 || tier2Count >= 1) return 90;
  if (independentCount >= 2) return 80;
  if (independentCount === 1) return 70;
  return independentCount > 0 ? 55 : 0;
}

// evidence input shape = the sanitized `research.js` output:
// {
//   dealer_group, parent_company, related_dealerships, official_group_website,
//   group_site_confirms_dealership, independently_owned, independence_reason,
//   conflict_detected, conflicts, evidence: [{claim, source_tier, url, title}],
// }
export function decideMapping({ research, hubspotCandidates = [] }) {
  const candidateGroup = research?.dealer_group || null;
  const evidenceLog = [];

  if (!candidateGroup) {
    if (research?.independently_owned) {
      evidenceLog.push(research.independence_reason || 'Research found no evidence of group ownership.');
      return {
        recommendation: 'NO_GROUP_FOUND',
        confidence: research.evidence?.length ? 70 : 40,
        dealer_group: null,
        hubspot_group_name: null,
        hubspot_group_record_id: null,
        match_type: 'NO_MATCH',
        match_confidence: 0,
        reason: research.independence_reason || 'No dealership group found after research; evidence suggests independent ownership.',
        evidence: evidenceLog,
      };
    }
    return {
      recommendation: 'REVIEW',
      confidence: 0,
      dealer_group: null,
      hubspot_group_name: null,
      hubspot_group_record_id: null,
      match_type: 'NO_MATCH',
      match_confidence: 0,
      reason: 'No ownership, parent company, or dealer group evidence found after research. This is not evidence of independence - flagged for manual review.',
      evidence: evidenceLog,
    };
  }

  const supportingEvidence = (research.evidence || []).filter((e) => e.source_tier);
  evidenceLog.push(`Candidate dealership group identified as "${candidateGroup}"`);
  supportingEvidence.forEach((e) => evidenceLog.push(`[${e.source_tier}] ${e.claim} (${e.url})`));
  if (research.group_site_confirms_dealership) evidenceLog.push(`Confirmed on the group's own official website (${research.official_group_website})`);

  if (research.conflict_detected) {
    (research.conflicts || []).forEach((c) =>
      evidenceLog.push(`CONFLICT: "${c.claim_a}" (${c.source_a}) vs. "${c.claim_b}" (${c.source_b})${c.possible_reason ? ` - ${c.possible_reason}` : ''}`)
    );
    return {
      recommendation: 'REVIEW',
      confidence: computeOwnershipConfidence({ candidateGroup, evidence: supportingEvidence, verifiedOnGroupSite: false, conflictDetected: true }),
      dealer_group: candidateGroup,
      hubspot_group_name: null,
      hubspot_group_record_id: null,
      match_type: 'NO_MATCH',
      match_confidence: 0,
      reason: 'Sources disagree on current ownership. Prefer the newest reliable evidence and confirm manually.',
      evidence: evidenceLog,
    };
  }

  const confidence = computeOwnershipConfidence({
    candidateGroup,
    evidence: supportingEvidence,
    verifiedOnGroupSite: Boolean(research.group_site_confirms_dealership),
    conflictDetected: false,
  });

  const viaAcquisition = Boolean(research.acquisition?.current_group && namesLikelyMatch(research.acquisition.current_group, candidateGroup));
  const viaOwnership = !viaAcquisition && Boolean(research.parent_company && !namesLikelyMatch(research.parent_company, candidateGroup));
  const { record: hubspotRecord, matchType } = findBestHubSpotMatch(candidateGroup, hubspotCandidates, { viaAcquisition, viaOwnership });
  const hubspotGroupName = hubspotRecord?.properties?.dealership_group_name || hubspotRecord?.properties?.name || null;
  const matchConfidence = { EXACT_MATCH: 100, NORMALIZED_MATCH: 95, ACQUISITION_MATCH: 90, OWNERSHIP_MATCH: 85, ALIAS_MATCH: 80, POSSIBLE_MATCH: 55, NO_MATCH: 0 }[matchType];

  let recommendation;
  let reason;
  const corroborationNote = supportingEvidence.length ? ` corroborated by ${supportingEvidence.length} source(s)` : '';
  const verificationNote = research.group_site_confirms_dealership ? ", confirmed on the group's own website" : '';

  if (confidence >= 95) {
    recommendation = hubspotRecord ? 'MAP' : 'CREATE_NEW_GROUP';
    reason = hubspotRecord
      ? `Ownership confirmed${corroborationNote}${verificationNote}; matches existing HubSpot group "${hubspotGroupName}" (${matchType}).`
      : `Ownership confirmed${corroborationNote}${verificationNote}; no matching HubSpot Dealership Group record exists yet.`;
  } else if (confidence >= 80) {
    recommendation = 'REVIEW';
    reason = `Likely current ownership identified${corroborationNote}, but below the auto-map confidence threshold - recommend human review before mapping${hubspotRecord ? ` (possible HubSpot match: "${hubspotGroupName}", ${matchType})` : ''}.`;
  } else if (confidence >= 50) {
    recommendation = 'REVIEW';
    reason = 'Some evidence of ownership was found but it is thin or from lower-reliability sources - recommend review, or run Deep Research for more corroboration.';
  } else {
    recommendation = 'REVIEW';
    reason = 'Evidence is insufficient for automatic mapping.';
  }

  return {
    recommendation,
    confidence,
    dealer_group: candidateGroup,
    hubspot_group_name: hubspotGroupName,
    hubspot_group_record_id: hubspotRecord?.id || null,
    match_type: matchType,
    match_confidence: matchConfidence,
    reason,
    evidence: evidenceLog,
  };
}
