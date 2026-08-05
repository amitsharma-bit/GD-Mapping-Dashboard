import assert from 'node:assert';
import { decideOwnership } from '../server/lib/decision.js';

// MAP: official site + 2 independent corroborating sources agree, matching HubSpot group exists
{
  const result = decideOwnership({
    officialSite: { dealer_group: 'Lithia Motors' },
    candidateSource: 'official_site',
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
    candidateSource: 'official_site',
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
    candidateSource: 'official_site',
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
    candidateSource: 'official_site',
    corroboratingSources: [],
    hubspotCandidates: [],
  });
  assert.equal(result.recommendation, 'REVIEW');
  assert.equal(result.confidence, 70);
}

// REVIEW: no evidence anywhere - must NOT be reported as "independent"
{
  const result = decideOwnership({ officialSite: {}, corroboratingSources: [], hubspotCandidates: [] });
  assert.equal(result.recommendation, 'REVIEW');
  assert.equal(result.confidence, 0);
  assert.doesNotMatch(result.reason, /is independent/i);
}

// MAP: candidate group name is an alias/rebrand of the stored HubSpot value, not identical text
// (mirrors the spec's "Lithia / Lithia Motors / Lithia Motors Inc. / Lithia Auto" example)
{
  const result = decideOwnership({
    officialSite: { dealer_group: 'Lithia & Driveway' },
    candidateSource: 'official_site',
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

// CREATE_NEW_GROUP, not a false-positive MAP: two different companies that both just
// happen to say "Automotive" in their name must NOT be treated as aliases of each other.
// Regression test for a real bug found live: "Sonic Automotive" matched an unrelated
// HubSpot group "Battlefield Automotive" at 100% confidence because "automotive" wasn't
// stripped as a generic term the way "motors"/"group" already were.
{
  const result = decideOwnership({
    officialSite: { dealer_group: 'Sonic Automotive' },
    candidateSource: 'official_site',
    corroboratingSources: [
      { source: 'pr_newswire', url: 'https://prnewswire.com/x', mentionedGroup: 'Sonic Automotive' },
      { source: 'automotive_news', url: 'https://autonews.com/x', mentionedGroup: 'Sonic Automotive' },
    ],
    hubspotCandidates: [
      { id: '99', properties: { name: 'Battlefield Automotive', dealership_group_name: 'Battlefield Automotive' } },
    ],
  });
  assert.equal(result.recommendation, 'CREATE_NEW_GROUP');
  assert.equal(result.hubspot_group_found, false);
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

// MAP: a name mined from search (weaker provenance, base 60) still reaches the 95
// threshold once corroborated by two independent sources AND confirmed on the group's own
// official website - this is the case that was previously impossible to auto-map: the
// dealership's site says nothing about ownership at all, but external research plus
// direct verification is enough. 60 base + 30 (2 sources) + 15 (verified) = 100.
{
  const result = decideOwnership({
    officialSite: { dealer_group: 'Premier Auto Group' },
    candidateSource: 'search_mined',
    corroboratingSources: [
      { source: 'trade_press', url: 'https://autonews.com/x', mentionedGroup: 'Premier Auto Group' },
      { source: 'owner', url: 'https://prnewswire.com/x', mentionedGroup: 'Premier Auto Group' },
    ],
    hubspotCandidates: [
      { id: '7', properties: { name: 'Premier Auto Group', dealership_group_name: 'Premier Auto Group' } },
    ],
    verifiedByGroupSite: true,
  });
  assert.equal(result.recommendation, 'MAP');
  assert.ok(result.confidence >= 95);
  assert.match(result.reason, /group's own website/i);
}

// REVIEW, not MAP: same search-mined candidate with only ONE corroborating source plus
// verification (60 + 15 + 15 = 90) stays just under the 95 auto-map bar.
{
  const result = decideOwnership({
    officialSite: { dealer_group: 'Premier Auto Group' },
    candidateSource: 'search_mined',
    corroboratingSources: [
      { source: 'trade_press', url: 'https://autonews.com/x', mentionedGroup: 'Premier Auto Group' },
    ],
    hubspotCandidates: [],
    verifiedByGroupSite: true,
  });
  assert.equal(result.confidence, 90);
  assert.equal(result.recommendation, 'REVIEW');
}

// REVIEW, not MAP: the same search-mined candidate WITHOUT website verification and only
// one corroborating source stays below the auto-map bar - weaker provenance alone isn't
// enough, matching "never auto-map below high confidence."
{
  const result = decideOwnership({
    officialSite: { dealer_group: 'Premier Auto Group' },
    candidateSource: 'search_mined',
    corroboratingSources: [
      { source: 'trade_press', url: 'https://autonews.com/x', mentionedGroup: 'Premier Auto Group' },
    ],
    hubspotCandidates: [],
  });
  assert.equal(result.confidence, 75); // 60 base + 15 for one corroborating source
  assert.equal(result.recommendation, 'REVIEW');
}

// Owner-fallback provenance (weakest) produces the lowest base confidence of the three tiers
{
  const result = decideOwnership({
    officialSite: { dealer_group: 'Weak Signal Group' },
    candidateSource: 'owner_fallback',
    corroboratingSources: [],
    hubspotCandidates: [],
  });
  assert.equal(result.confidence, 55);
}

console.log('decision.test.js: all checks passed');
