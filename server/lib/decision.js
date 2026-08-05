import { namesLikelyMatch } from './normalize.js';

// Base confidence depends on how the candidate group name was actually discovered - a
// first-party claim on the dealership's own site is more reliable than a name mined from a
// third-party search snippet, which is in turn more reliable than a name found only by
// following the owner's name to a second, unrelated search (two inferential hops removed
// from the dealership itself). Matches the "100 = official corporate website confirms /
// 95 = multiple independent sources agree / 90 = strong public evidence" framing while
// keeping the same MAP-eligibility bar this tool has always used.
const BASE_CONFIDENCE = { official_site: 70, search_mined: 60, owner_fallback: 55 };

// evidence = {
//   officialSite: { dealer_group, parent_company, owner, dealer_principal, ceo, is_independently_owned, ... } | null,
//   candidateSource: 'official_site' | 'search_mined' | 'owner_fallback' | null,
//   corroboratingSources: [{ source, url, mentionedGroup }],
//   hubspotCandidates: [{ id, properties: { name, dealership_group_name } }],
//   verifiedByGroupSite: boolean,
// }
export function decideOwnership(evidence) {
  const site = evidence.officialSite || {};
  const candidateRaw = site.dealer_group || site.parent_company || null;

  if (!candidateRaw) {
    if (site.is_independently_owned) {
      return {
        recommendation: 'REVIEW',
        confidence: 60,
        dealer_group: null,
        hubspot_group_found: false,
        hubspot_group_record_id: null,
        reason:
          'Official site states the dealership is independently owned. No HubSpot Dealership Group applies; flagged for human confirmation rather than auto-closed.',
        evidence: ['Official site: independently owned'],
      };
    }
    // Per the research workflow's own rule: silence about a group is not evidence OF
    // independence, so this is reported as inconclusive (REVIEW, confidence 0), never as
    // "independent" - the dealership may still belong to a HubSpot group we simply
    // couldn't find public evidence for after exhausting the available sources.
    return {
      recommendation: 'REVIEW',
      confidence: 0,
      dealer_group: null,
      hubspot_group_found: false,
      hubspot_group_record_id: null,
      reason: 'No ownership, parent company, or dealer group evidence found in any source after exhausting available research. Not evidence of independence - flagged for manual review.',
      evidence: [],
    };
  }

  const corroborating = evidence.corroboratingSources || [];
  const agreeing = corroborating.filter((s) => s.mentionedGroup && namesLikelyMatch(s.mentionedGroup, candidateRaw));
  const conflicting = corroborating.filter((s) => s.mentionedGroup && !namesLikelyMatch(s.mentionedGroup, candidateRaw));

  const evidenceLog = [`Candidate group/parent identified as "${candidateRaw}"`, ...agreeing.map((s) => `${s.source} corroborates "${candidateRaw}" (${s.url})`)];
  if (evidence.verifiedByGroupSite) evidenceLog.push(`Confirmed on the group's own official website`);

  if (conflicting.length > 0) {
    return {
      recommendation: 'REVIEW',
      confidence: Math.min(40, 30 + agreeing.length * 5),
      dealer_group: candidateRaw,
      hubspot_group_found: false,
      hubspot_group_record_id: null,
      reason: `Sources disagree on ownership: "${candidateRaw}" vs. ${conflicting
        .map((s) => `${s.source} saying "${s.mentionedGroup}"`)
        .join(', ')}.`,
      evidence: [...evidenceLog, ...conflicting.map((s) => `CONFLICT: ${s.source} says "${s.mentionedGroup}" (${s.url})`)],
    };
  }

  const uniqueAgreeingSources = new Set(agreeing.map((s) => s.source)).size;
  const base = BASE_CONFIDENCE[evidence.candidateSource] ?? BASE_CONFIDENCE.search_mined;
  // Each independent corroborating source adds 15; confirming against the group's own
  // official website (see pipeline.js: verifyAgainstGroupSite) adds another 15 - the
  // closest affordable approximation of "visit the parent group's website and confirm
  // this dealership is listed there."
  const confidence = Math.min(100, base + uniqueAgreeingSources * 15 + (evidence.verifiedByGroupSite ? 15 : 0));

  const hubspotCandidates = evidence.hubspotCandidates || [];
  const matches = hubspotCandidates.filter((c) => namesLikelyMatch(c.properties?.dealership_group_name || '', candidateRaw));
  // Prefer the record that represents the group itself (name === dealership_group_name) over a rooftop record.
  const groupRecord = matches.find((c) => c.properties?.name === c.properties?.dealership_group_name) || matches[0];

  let recommendation;
  let reason;
  const corroborationNote = agreeing.length ? ` and ${uniqueAgreeingSources} corroborating source(s)` : '';
  const verificationNote = evidence.verifiedByGroupSite ? ', confirmed on the group\'s own website' : '';
  if (confidence >= 95) {
    recommendation = groupRecord ? 'MAP' : 'CREATE_NEW_GROUP';
    reason = groupRecord
      ? `Ownership confirmed${corroborationNote}${verificationNote}; matches existing HubSpot group "${groupRecord.properties.dealership_group_name}".`
      : `Ownership confirmed${corroborationNote}${verificationNote}; no matching HubSpot Dealership Group exists yet.`;
  } else if (confidence >= 90) {
    recommendation = 'REVIEW';
    reason = 'Strong public evidence but below the 95 auto-map threshold; recommend human review before mapping.';
  } else if (confidence >= 80) {
    recommendation = 'REVIEW';
    reason = 'Likely ownership identified but not yet strongly corroborated; recommend review.';
  } else {
    recommendation = 'REVIEW';
    reason = 'Evidence is below the confidence threshold for automatic mapping.';
  }

  return {
    recommendation,
    confidence,
    dealer_group: candidateRaw,
    hubspot_group_found: Boolean(groupRecord),
    hubspot_group_record_id: groupRecord?.id || null,
    reason,
    evidence: evidenceLog,
  };
}
