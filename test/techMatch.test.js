import assert from 'node:assert';
import { detectTechnologies } from '../server/lib/techMatch.js';

function emptyMerged(overrides = {}) {
  return {
    scriptSrcs: [],
    iframeSrcs: [],
    inlineScripts: [],
    jsonLd: [],
    metadataEntries: [],
    formActions: [],
    stylesheetHrefs: [],
    linkHrefs: [],
    pageUrls: [],
    ...overrides,
  };
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
  assert.equal(gubagoo.method, 'Script URL');
}

// confidence 100: inline script content mentioning the vendor's domain counts as strong
// evidence too (an API endpoint hardcoded in executable JS), not just <script src>
{
  const detected = detectTechnologies(
    emptyMerged({ inlineScripts: [{ content: 'loadWidget("https://widget.gubagoo.io/x");', pageUrl: 'https://x.com/' }] })
  );
  const gubagoo = detected.find((d) => d.name === 'Gubagoo');
  assert.ok(gubagoo);
  assert.equal(gubagoo.confidence, 100);
  assert.equal(gubagoo.method, 'Inline script');
}

// Dealer.com's meta-tag signal alone (no matching script) is a moderate, single hit -> 90
{
  const detected = detectTechnologies(
    emptyMerged({ metadataEntries: [{ metadata: { 'ddc:site-alt': 'lang=en_US' }, pageUrl: 'https://x.com/' }] })
  );
  const ddc = detected.find((d) => d.name === 'Dealer.com');
  assert.ok(ddc);
  assert.equal(ddc.confidence, 90);
  assert.equal(ddc.method, 'Meta tag');
}

// Two distinct moderate-tier evidence types (meta tag + JSON-LD) reach 95
{
  const detected = detectTechnologies(
    emptyMerged({
      metadataEntries: [{ metadata: { 'ddc:site-alt': 'lang=en_US' }, pageUrl: 'https://x.com/' }],
      jsonLd: [{ data: { '@type': 'AutoDealer', provider: 'ddc.min.js' }, pageUrl: 'https://x.com/' }],
    })
  );
  const ddc = detected.find((d) => d.name === 'Dealer.com');
  assert.equal(ddc.confidence, 95);
}

// Identical meta hit repeated across crawled pages dedupes - doesn't inflate to 95
{
  const detected = detectTechnologies(
    emptyMerged({
      metadataEntries: [
        { metadata: { 'ddc:site-alt': 'lang=en_US' }, pageUrl: 'https://x.com/page-a' },
        { metadata: { 'ddc:site-alt': 'lang=en_US' }, pageUrl: 'https://x.com/page-b' },
      ],
    })
  );
  const ddc = detected.find((d) => d.name === 'Dealer.com');
  assert.equal(ddc.confidence, 90, 'identical meta tag repeated across pages should dedupe, not count as 2 resources');
}

// confidence 80: a plain link href to the vendor's page, with nothing else - the new
// "indirect evidence" tier. This is what fixes CRM/Service Scheduler coverage: those tools
// are frequently just a "Schedule Service" link or a form action, never a sitewide script.
{
  const detected = detectTechnologies(
    emptyMerged({ linkHrefs: [{ href: 'https://www.xtime.com/schedule/12345', pageUrl: 'https://x.com/service' }] })
  );
  const xtime = detected.find((d) => d.name === 'Xtime');
  assert.ok(xtime, 'Xtime should be detected from a plain link href even with no script/iframe');
  assert.equal(xtime.confidence, 80);
  assert.equal(xtime.category, 'scheduling');
  assert.equal(xtime.method, 'Linked URL');
}

// confidence 80: a lead-capture form posting straight to the CRM vendor's endpoint
{
  const detected = detectTechnologies(
    emptyMerged({ formActions: [{ href: 'https://api.vinsolutions.com/leads/submit', pageUrl: 'https://x.com/contact' }] })
  );
  const vin = detected.find((d) => d.name === 'VinSolutions');
  assert.ok(vin);
  assert.equal(vin.confidence, 80);
  assert.equal(vin.method, 'Form action URL');
}

// confidence 80: a vendor's own stylesheet loading, with no other evidence
{
  const detected = detectTechnologies(
    emptyMerged({ stylesheetHrefs: [{ href: 'https://cdn.mykaarma.com/widget.css', pageUrl: 'https://x.com/' }] })
  );
  const myk = detected.find((d) => d.name === 'MyKaarma');
  assert.ok(myk);
  assert.equal(myk.confidence, 80);
  assert.equal(myk.method, 'Stylesheet reference');
}

// A shared domain (e.g. tekion.com) legitimately triggers multiple category entries, since
// the same platform genuinely offers CRM, Scheduler, and DMS products under one domain and
// there's no way to tell which module is in use from the domain alone.
{
  const detected = detectTechnologies(
    emptyMerged({ scriptSrcs: [{ src: 'https://cdn.tekion.com/app.js', pageUrl: 'https://x.com/' }] })
  );
  const names = detected.filter((d) => d.name.startsWith('Tekion')).map((d) => d.category).sort();
  assert.deepEqual(names, ['crm', 'dms', 'scheduling']);
}

// No matching evidence at all -> not reported (never guess)
{
  const detected = detectTechnologies(emptyMerged());
  assert.equal(detected.length, 0);
}

console.log('techMatch.test.js: all checks passed');
