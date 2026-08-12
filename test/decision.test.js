import assert from 'node:assert';
import { decideMapping, classifyMatchType, findBestHubSpotMatch } from '../server/lib/decision.js';

function evidence(source_tier, claim = 'ownership confirmed', url = 'https://example.com/x') {
  return { claim, source_tier, url, title: null };
}

// MAP: tier1 evidence + 2 corroborating sources, matching HubSpot group exists
{
  const research = {
    dealer_group: 'Lithia Motors',
    evidence: [evidence('tier1', 'a', 'https://lithiamotors.com/x'), evidence('tier2', 'b'), evidence('tier2', 'c')],
    conflict_detected: false,
  };
  const hubspotCandidates = [{ id: '1', properties: { name: 'Lithia Motors', dealership_group_name: 'Lithia Motors' } }];
  const result = decideMapping({ research, hubspotCandidates });
  assert.equal(result.recommendation, 'MAP');
  assert.ok(result.confidence >= 95);
  assert.equal(result.hubspot_group_record_id, '1');
  assert.equal(result.match_type, 'EXACT_MATCH');
}

// CREATE_NEW_GROUP: strong tier1+tier2 agreement, no existing HubSpot match
{
  const research = {
    dealer_group: 'Acme Auto Group',
    evidence: [evidence('tier1'), evidence('tier2'), evidence('tier2')],
    conflict_detected: false,
  };
  const result = decideMapping({ research, hubspotCandidates: [] });
  assert.equal(result.recommendation, 'CREATE_NEW_GROUP');
  assert.equal(result.hubspot_group_record_id, null);
}

// REVIEW: conflicting sources - never hidden, always downgraded to review
{
  const research = {
    dealer_group: 'Acme Auto Group',
    evidence: [evidence('tier2')],
    conflict_detected: true,
    conflicts: [{ claim_a: 'Acme Auto Group', source_a: 'https://a.com', claim_b: 'Zenith Motors', source_b: 'https://b.com', possible_reason: 'outdated source' }],
  };
  const result = decideMapping({ research, hubspotCandidates: [] });
  assert.equal(result.recommendation, 'REVIEW');
  assert.match(result.reason, /disagree/i);
  assert.ok(result.evidence.some((e) => e.startsWith('CONFLICT')));
}

// REVIEW: single corroborating source, below the 95 auto-map threshold
{
  const research = {
    dealer_group: 'Solo Group',
    evidence: [evidence('tier3')],
    conflict_detected: false,
  };
  const result = decideMapping({ research, hubspotCandidates: [] });
  assert.equal(result.recommendation, 'REVIEW');
  assert.equal(result.confidence, 70);
}

// REVIEW (NO_GROUP_FOUND is the correct outcome, not silently MAP-ing): no dealer_group
// and no independence evidence - must NOT be reported as confirmed independent.
{
  const research = { dealer_group: null, evidence: [], conflict_detected: false, independently_owned: false };
  const result = decideMapping({ research, hubspotCandidates: [] });
  assert.equal(result.recommendation, 'REVIEW');
  assert.equal(result.confidence, 0);
  assert.doesNotMatch(result.reason, /confirmed independent/i);
}

// NO_GROUP_FOUND: explicit, evidence-backed independence conclusion
{
  const research = {
    dealer_group: null,
    evidence: [],
    conflict_detected: false,
    independently_owned: true,
    independence_reason: 'Owner confirmed via press interview to run this as a standalone store with no group affiliation.',
  };
  const result = decideMapping({ research, hubspotCandidates: [] });
  assert.equal(result.recommendation, 'NO_GROUP_FOUND');
  assert.match(result.reason, /standalone/i);
}

// MAP: candidate group name is an alias/rebrand of the stored HubSpot value, not
// identical text (mirrors "Lithia" / "Lithia Motors" / "Lithia & Driveway").
{
  const research = {
    dealer_group: 'Lithia & Driveway',
    evidence: [evidence('tier1'), evidence('tier2'), evidence('tier2')],
    conflict_detected: false,
  };
  const hubspotCandidates = [{ id: '42', properties: { name: 'Lithia Motors', dealership_group_name: 'Lithia Motors' } }];
  const result = decideMapping({ research, hubspotCandidates });
  assert.equal(result.recommendation, 'MAP');
  assert.equal(result.hubspot_group_record_id, '42');
  assert.equal(result.match_type, 'ALIAS_MATCH');
}

// CREATE_NEW_GROUP, not a false-positive MAP: two different companies that both just
// happen to say "Automotive" in their name must NOT be treated as aliases of each
// other. Regression test for a real bug found live in the previous pipeline version:
// "Sonic Automotive" matched an unrelated HubSpot group "Battlefield Automotive" at
// 100% confidence because "automotive" wasn't stripped as a generic term.
{
  const research = {
    dealer_group: 'Sonic Automotive',
    evidence: [evidence('tier1'), evidence('tier2'), evidence('tier2')],
    conflict_detected: false,
  };
  const hubspotCandidates = [{ id: '99', properties: { name: 'Battlefield Automotive', dealership_group_name: 'Battlefield Automotive' } }];
  const result = decideMapping({ research, hubspotCandidates });
  assert.equal(result.recommendation, 'CREATE_NEW_GROUP');
  assert.equal(result.hubspot_group_record_id, null);
  assert.equal(result.match_type, 'NO_MATCH');
}

// Match-type classification unit checks
{
  const exactRecord = { properties: { name: 'ABC Group', dealership_group_name: 'ABC Group' } };
  assert.equal(classifyMatchType('ABC Group', exactRecord), 'EXACT_MATCH');

  const normalizedRecord = { properties: { name: 'ABC Group Inc.', dealership_group_name: 'ABC Group Inc.' } };
  assert.equal(classifyMatchType('ABC Group', normalizedRecord), 'NORMALIZED_MATCH');

  assert.equal(classifyMatchType('Totally Unrelated Co', exactRecord), 'NO_MATCH');
  assert.equal(classifyMatchType(null, exactRecord), 'NO_MATCH');
}

// findBestHubSpotMatch prefers the record that represents the group itself over a
// rooftop record that merely carries the same dealership_group_name property.
{
  const groupRecord = { id: 'group-1', properties: { name: 'ABC Group', dealership_group_name: 'ABC Group' } };
  const rooftopRecord = { id: 'rooftop-1', properties: { name: 'ABC Ford of Springfield', dealership_group_name: 'ABC Group' } };
  const { record, matchType } = findBestHubSpotMatch('ABC Group', [rooftopRecord, groupRecord]);
  assert.equal(record.id, 'group-1');
  assert.equal(matchType, 'EXACT_MATCH');
}

// 50-69 band: some evidence but too weak alone to review-and-approve confidently
{
  const research = { dealer_group: 'Weak Signal Group', evidence: [], conflict_detected: false };
  const result = decideMapping({ research, hubspotCandidates: [] });
  assert.equal(result.confidence, 0);
  assert.equal(result.recommendation, 'REVIEW');
}

console.log('decision.test.js: all checks passed');
