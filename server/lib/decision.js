import { namesLikelyMatch } from './normalize.js';

// evidence = {
//   officialSite: { dealer_group, parent_company, owner, dealer_principal, ceo, is_independently_owned, ... } | null,
//   corroboratingSources: [{ source, url, mentionedGroup }],
//   hubspotCandidates: [{ id, properties: { name, dealership_group_name } }],
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
    return {
      recommendation: 'REVIEW',
      confidence: 0,
      dealer_group: null,
      hubspot_group_found: false,
      hubspot_group_record_id: null,
      reason: 'No ownership, parent company, or dealer group evidence found in any source.',
      evidence: [],
    };
  }

  const corroborating = evidence.corroboratingSources || [];
  const agreeing = corroborating.filter((s) => s.mentionedGroup && namesLikelyMatch(s.mentionedGroup, candidateRaw));
  const conflicting = corroborating.filter((s) => s.mentionedGroup && !namesLikelyMatch(s.mentionedGroup, candidateRaw));

  const evidenceLog = [`Official site names group/parent as "${candidateRaw}"`, ...agreeing.map((s) => `${s.source} corroborates "${candidateRaw}" (${s.url})`)];

  if (conflicting.length > 0) {
    return {
      recommendation: 'REVIEW',
      confidence: Math.min(40, 30 + agreeing.length * 5),
      dealer_group: candidateRaw,
      hubspot_group_found: false,
      hubspot_group_record_id: null,
      reason: `Sources disagree on ownership: official site says "${candidateRaw}" but ${conflicting
        .map((s) => `${s.source} says "${s.mentionedGroup}"`)
        .join(', ')}.`,
      evidence: [...evidenceLog, ...conflicting.map((s) => `CONFLICT: ${s.source} says "${s.mentionedGroup}" (${s.url})`)],
    };
  }

  const uniqueAgreeingSources = new Set(agreeing.map((s) => s.source)).size;
  // Official site alone (75) is treated as insufficient on its own; each independent
  // corroborating source (LinkedIn, PR wire, Automotive News, etc.) adds 15, so two
  // independent corroborations are enough to clear the 95 auto-map threshold.
  const confidence = Math.min(100, 75 + uniqueAgreeingSources * 15);

  const hubspotCandidates = evidence.hubspotCandidates || [];
  const matches = hubspotCandidates.filter((c) => namesLikelyMatch(c.properties?.dealership_group_name || '', candidateRaw));
  // Prefer the record that represents the group itself (name === dealership_group_name) over a rooftop record.
  const groupRecord = matches.find((c) => c.properties?.name === c.properties?.dealership_group_name) || matches[0];

  let recommendation;
  let reason;
  if (confidence >= 95) {
    recommendation = groupRecord ? 'MAP' : 'CREATE_NEW_GROUP';
    reason = groupRecord
      ? `Ownership confirmed by official site${agreeing.length ? ' and ' + uniqueAgreeingSources + ' corroborating source(s)' : ''}; matches existing HubSpot group "${groupRecord.properties.dealership_group_name}".`
      : `Ownership confirmed by official site${agreeing.length ? ' and ' + uniqueAgreeingSources + ' corroborating source(s)' : ''}; no matching HubSpot Dealership Group exists yet.`;
  } else if (confidence >= 90) {
    recommendation = 'REVIEW';
    reason = 'Strong candidate but below the 95 auto-map threshold; recommend human review before mapping.';
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
