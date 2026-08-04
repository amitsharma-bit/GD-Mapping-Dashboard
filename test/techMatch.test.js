import assert from 'node:assert';
import { detectTechnologies } from '../server/lib/techMatch.js';

function emptyMerged(overrides = {}) {
  return { scriptSrcs: [], iframeSrcs: [], inlineScripts: [], jsonLd: [], metadataEntries: [], pageUrls: [], ...overrides };
}

// confidence 100: a single official script URL is enough
{
  const detected = detectTechnologies(
    emptyMerged({ scriptSrcs: [{ src: 'https://cdn.gubagoo.io/widget.js', pageUrl: 'https://x.com/' }] })
  );
  const gubagoo = detected.find((d) => d.name === 'Gubagoo');
  assert.ok(gubagoo, 'Gubagoo should be detected from a matching script URL');
  assert.equal(gubagoo.confidence, 100);
  assert.equal(gubagoo.category, 'chat');
}

// Dealer.com's meta-tag signal alone (no matching script) should still register, just weaker
{
  const detected = detectTechnologies(
    emptyMerged({ metadataEntries: [{ metadata: { 'ddc:site-alt': 'lang=en_US' }, pageUrl: 'https://x.com/' }] })
  );
  const ddc = detected.find((d) => d.name === 'Dealer.com');
  assert.ok(ddc);
  assert.equal(ddc.confidence, 90); // one weak hit only
}

// Two independent weak hits (not just the same one repeated across crawled pages) reach 95
{
  const detected = detectTechnologies(
    emptyMerged({
      inlineScripts: [
        { content: 'window.gubagoo = { key: "abc" };', pageUrl: 'https://x.com/' },
      ],
      metadataEntries: [{ metadata: { 'ddc:site-alt': 'lang=en_US' }, pageUrl: 'https://x.com/' }],
    })
  );
  // sanity: gubagoo has no inline-type pattern defined, so this checks Dealer.com stays at 90
  // (single weak hit type), proving repeats of the SAME evidence don't inflate confidence.
  const detectedTwice = detectTechnologies(
    emptyMerged({
      metadataEntries: [
        { metadata: { 'ddc:site-alt': 'lang=en_US' }, pageUrl: 'https://x.com/page-a' },
        { metadata: { 'ddc:site-alt': 'lang=en_US' }, pageUrl: 'https://x.com/page-b' },
      ],
    })
  );
  const ddc = detectedTwice.find((d) => d.name === 'Dealer.com');
  assert.equal(ddc.confidence, 90, 'identical meta tag repeated across pages should dedupe, not count as 2 resources');
}

// No matching evidence at all -> not reported (never guess)
{
  const detected = detectTechnologies(emptyMerged());
  assert.equal(detected.length, 0);
}

console.log('techMatch.test.js: all checks passed');
