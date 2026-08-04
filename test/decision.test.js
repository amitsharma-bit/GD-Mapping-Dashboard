import assert from 'node:assert';
import { decideOwnership } from '../server/lib/decision.js';

// MAP: official site + 2 independent corroborating sources agree, matching HubSpot group exists
{
  const result = decideOwnership({
    officialSite: { dealer_group: 'Lithia Motors' },
    corroboratingSources: [
      { source: 'linkedin', url: 'https://linkedin.com/x', mentionedGroup: 'Lithia Motors Inc.' },
      { source: 'google', url: 'https://google.com/x', mentionedGroup: 'Lithia Motors' },
    ],
    hubspotCandidates: [
      { id: '1', properties: { name: 'Lithia Motors', dealership_group_name: 'Lithia Motors' } },
    ],
  });
  assert.equal(result.recommendation, 'MAP');
  assert.ok(result.confidence >= 95);
  assert.equal(result.hubspot_group_record_id, '1');
}

// CREATE_NEW_GROUP: strong agreement, no existing HubSpot match
{
  const result = decideOwnership({
    officialSite: { dealer_group: 'Acme Auto Group' },
    corroboratingSources: [
      { source: 'pr_newswire', url: 'https://prnewswire.com/x', mentionedGroup: 'Acme Auto Group' },
      { source: 'automotive_news', url: 'https://autonews.com/x', mentionedGroup: 'Acme Auto Group' },
    ],
    hubspotCandidates: [],
  });
  assert.equal(result.recommendation, 'CREATE_NEW_GROUP');
  assert.equal(result.hubspot_group_found, false);
}

// REVIEW: conflicting sources
{
  const result = decideOwnership({
    officialSite: { dealer_group: 'Acme Auto Group' },
    corroboratingSources: [{ source: 'google', url: 'https://x.com', mentionedGroup: 'Zenith Motors' }],
    hubspotCandidates: [],
  });
  assert.equal(result.recommendation, 'REVIEW');
  assert.match(result.reason, /disagree/i);
}

// REVIEW: only official site, no corroboration, below 95 threshold
{
  const result = decideOwnership({
    officialSite: { dealer_group: 'Solo Group' },
    corroboratingSources: [],
    hubspotCandidates: [],
  });
  assert.equal(result.recommendation, 'REVIEW');
  assert.equal(result.confidence, 75);
}

// REVIEW: no evidence anywhere
{
  const result = decideOwnership({ officialSite: {}, corroboratingSources: [], hubspotCandidates: [] });
  assert.equal(result.recommendation, 'REVIEW');
  assert.equal(result.confidence, 0);
}

// MAP: candidate group name is an alias/rebrand of the stored HubSpot value, not identical text
// (mirrors the spec's "Lithia / Lithia Motors / Lithia Motors Inc. / Lithia Auto" example)
{
  const result = decideOwnership({
    officialSite: { dealer_group: 'Lithia & Driveway' },
    corroboratingSources: [
      { source: 'pr_newswire', url: 'https://prnewswire.com/x', mentionedGroup: 'Lithia & Driveway' },
      { source: 'automotive_news', url: 'https://autonews.com/x', mentionedGroup: 'Lithia & Driveway' },
    ],
    hubspotCandidates: [
      { id: '42', properties: { name: 'Lithia Motors', dealership_group_name: 'Lithia Motors' } },
    ],
  });
  assert.equal(result.recommendation, 'MAP');
  assert.equal(result.hubspot_group_record_id, '42');
}

// REVIEW (independent): site explicitly states independent ownership
{
  const result = decideOwnership({
    officialSite: { is_independently_owned: true },
    corroboratingSources: [],
    hubspotCandidates: [],
  });
  assert.equal(result.recommendation, 'REVIEW');
  assert.match(result.reason, /independently owned/i);
}

console.log('decision.test.js: all checks passed');
