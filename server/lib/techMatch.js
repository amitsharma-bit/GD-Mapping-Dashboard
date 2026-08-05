import { SIGNATURES } from './techSignatures.js';

function metaBlob(metadata) {
  return Object.entries(metadata || {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function dedupe(hits) {
  return [...new Map(hits.map((h) => [h.key, h])).values()];
}

// Every vendor's domain pattern is checked against ALL of these evidence sources, tiered
// by how strong a signal each source is - this is the core fix for CRM/Service Scheduler
// coverage, which previously only checked <script src>/<iframe src> and missed the common
// case of a plain "Schedule Service" link or a lead-capture form posting straight to the
// vendor's endpoint.
//
//   strong   (-> 100): script src, iframe src, inline script content - the vendor's code
//                      is demonstrably loaded or its endpoint is called.
//   moderate (-> 95 if >=2 distinct hits, 90 if 1): page metadata, JSON-LD - the vendor is
//                      referenced in structured page data, not necessarily "running" here.
//   indirect (-> 80): form action, stylesheet href, plain link href - could just be a
//                      footer link to the vendor's marketing site, not proof of an active
//                      integration, but still real evidence, not a guess.
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

  const metaRe = signature.metaExtra || domainRe;
  for (const { metadata, pageUrl } of merged.metadataEntries) {
    const match = metaBlob(metadata).match(metaRe);
    if (match) moderate.push({ method: 'Meta tag', evidence: match[0], source: pageUrl, key: `meta:${match[0]}` });
  }
  for (const { data, pageUrl } of merged.jsonLd) {
    const match = JSON.stringify(data).match(domainRe);
    if (match) moderate.push({ method: 'JSON-LD', evidence: match[0], source: pageUrl, key: `jsonld:${match[0]}` });
  }

  for (const { href, pageUrl } of merged.formActions) {
    if (domainRe.test(href)) indirect.push({ method: 'Form action URL', evidence: href, source: pageUrl, key: `form:${href}` });
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
