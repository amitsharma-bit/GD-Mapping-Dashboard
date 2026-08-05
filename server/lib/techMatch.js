import { SIGNATURES } from './techSignatures.js';

function metaBlob(metadata) {
  return Object.entries(metadata || {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function dedupe(hits) {
  return [...new Map(hits.map((h) => [h.key, h])).values()];
}

// A "Powered by X" / "Designed by X" footer credit is the site's own first-party claim
// about its platform - about as authoritative as evidence gets, arguably more so than an
// incidentally-loaded third-party script. Requires the credit phrase within a short window
// of the vendor's name (not just both appearing anywhere on the page) to avoid matching an
// unrelated mention, e.g. "Reynolds" as someone's last name in a testimonial.
const CREDIT_PHRASE_RE = /(powered by|designed by|website by|inventory by)/i;
const CREDIT_WINDOW = 60;

function findCreditMatch(text, namePattern) {
  const nameMatch = text.match(namePattern);
  if (!nameMatch) return null;
  const windowStart = Math.max(0, nameMatch.index - CREDIT_WINDOW);
  const before = text.slice(windowStart, nameMatch.index + nameMatch[0].length);
  return CREDIT_PHRASE_RE.test(before) ? before.replace(/\s+/g, ' ').trim() : null;
}

// Every vendor's domain pattern is checked against ALL of these evidence sources, tiered
// by how strong a signal each source is - this is the core fix for CRM/Service Scheduler
// coverage, which previously only checked <script src>/<iframe src> and missed the common
// case of a plain "Schedule Service" link or a lead-capture form posting straight to the
// vendor's endpoint.
//
//   strong   (-> 100): script src, iframe src, inline script content, or a footer "Powered
//                      by X" credit - the vendor's code is demonstrably loaded, its
//                      endpoint is called, or the site directly names its own platform.
//   moderate (-> 95 if >=2 distinct hits, 90 if 1): page metadata, JSON-LD - the vendor is
//                      referenced in structured page data, not necessarily "running" here.
//   indirect (-> 80): a lead-capture form's action/hidden fields, a stylesheet href, or a
//                      plain link href - could just be a footer link to the vendor's
//                      marketing site, not proof of an active integration, but still real
//                      evidence, not a guess.
function collectHits(signature, merged) {
  const strong = [];
  const moderate = [];
  const indirect = [];
  const domainRe = signature.domain;

  for (const { src, pageUrl } of merged.scriptSrcs) {
    if (domainRe.test(src)) strong.push({ method: 'Script URL', evidence: src, source: pageUrl, key: `script:${src}` });
  }
  for (const { src, pageUrl } of merged.iframeSrcs) {
    if (domainRe.test(src)) strong.push({ method: 'iframe URL', evidence: src, source: pageUrl, key: `iframe:${src}` });
  }
  for (const { content, pageUrl } of merged.inlineScripts) {
    const match = content.match(domainRe);
    if (match) strong.push({ method: 'Inline script', evidence: match[0], source: pageUrl, key: `inline:${match[0]}` });
  }
  if (signature.namePattern) {
    for (const { text, pageUrl } of merged.pageTexts) {
      const credit = findCreditMatch(text, signature.namePattern);
      if (credit) strong.push({ method: 'Footer credit', evidence: credit, source: pageUrl, key: `credit:${credit}` });
    }
  }

  const metaRe = signature.metaExtra || domainRe;
  for (const { metadata, pageUrl } of merged.metadataEntries) {
    const match = metaBlob(metadata).match(metaRe);
    if (match) moderate.push({ method: 'Meta tag', evidence: match[0], source: pageUrl, key: `meta:${match[0]}` });
  }
  for (const { data, pageUrl } of merged.jsonLd) {
    const match = JSON.stringify(data).match(domainRe);
    if (match) moderate.push({ method: 'JSON-LD', evidence: match[0], source: pageUrl, key: `jsonld:${match[0]}` });
  }

  for (const { html, action, pageUrl } of merged.formBlocks) {
    const match = html.match(domainRe);
    if (!match) continue;
    // Prefer the clean action= URL as the shown evidence when the vendor's domain
    // actually appears there; otherwise fall back to whatever matched inside the form
    // (e.g. a hidden input's value) so the evidence string stays meaningful.
    const evidence = action && domainRe.test(action) ? action : match[0];
    indirect.push({ method: 'Form field', evidence, source: pageUrl, key: `form:${evidence}` });
  }
  for (const { href, pageUrl } of merged.stylesheetHrefs) {
    if (domainRe.test(href)) indirect.push({ method: 'Stylesheet reference', evidence: href, source: pageUrl, key: `css:${href}` });
  }
  for (const { href, pageUrl } of merged.linkHrefs) {
    if (domainRe.test(href)) indirect.push({ method: 'Linked URL', evidence: href, source: pageUrl, key: `link:${href}` });
  }

  return { strong: dedupe(strong), moderate: dedupe(moderate), indirect: dedupe(indirect) };
}

export function detectTechnologies(merged) {
  const detected = [];
  for (const signature of SIGNATURES) {
    const { strong, moderate, indirect } = collectHits(signature, merged);
    let confidence;
    let representative;
    if (strong.length >= 1) {
      confidence = 100;
      representative = strong[0];
    } else if (moderate.length >= 2) {
      confidence = 95;
      representative = moderate[0];
    } else if (moderate.length === 1) {
      confidence = 90;
      representative = moderate[0];
    } else if (indirect.length >= 1) {
      confidence = 80;
      representative = indirect[0];
    } else {
      continue; // no evidence at all - never guess, don't report
    }

    detected.push({
      name: signature.name,
      category: signature.category,
      confidence,
      method: representative.method,
      evidence: representative.evidence,
      source: representative.source,
    });
  }
  return detected.sort((a, b) => b.confidence - a.confidence);
}
