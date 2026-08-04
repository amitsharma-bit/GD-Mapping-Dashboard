import { SIGNATURES } from './techSignatures.js';

function metaBlob(metadata) {
  return Object.entries(metadata || {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function collectHits(signature, merged) {
  const strong = []; // scriptSrc / iframeSrc - "official JS or iframe detected"
  const weak = []; // inline / meta / jsonld

  for (const pattern of signature.patterns) {
    if (pattern.type === 'scriptSrc') {
      for (const { src, pageUrl } of merged.scriptSrcs) {
        if (pattern.test.test(src)) strong.push({ evidence: `Script URL: ${src}`, source: pageUrl });
      }
    } else if (pattern.type === 'iframeSrc') {
      for (const { src, pageUrl } of merged.iframeSrcs) {
        if (pattern.test.test(src)) strong.push({ evidence: `iframe URL: ${src}`, source: pageUrl });
      }
    } else if (pattern.type === 'inline') {
      for (const { content, pageUrl } of merged.inlineScripts) {
        const match = content.match(pattern.test);
        if (match) weak.push({ evidence: `Inline script reference: "${match[0].slice(0, 80)}"`, source: pageUrl, key: `inline:${match[0].slice(0, 40)}` });
      }
    } else if (pattern.type === 'meta') {
      for (const { metadata, pageUrl } of merged.metadataEntries) {
        const match = metaBlob(metadata).match(pattern.test);
        if (match) weak.push({ evidence: `Meta tag match: "${match[0]}"`, source: pageUrl, key: `meta:${match[0]}` });
      }
    } else if (pattern.type === 'jsonld') {
      for (const { data, pageUrl } of merged.jsonLd) {
        const blob = JSON.stringify(data);
        const match = blob.match(pattern.test);
        if (match) weak.push({ evidence: `JSON-LD match: "${match[0]}"`, source: pageUrl, key: `jsonld:${match[0]}` });
      }
    }
  }

  const dedupedWeak = [...new Map(weak.map((w) => [w.key || w.evidence, w])).values()];
  return { strong, weak: dedupedWeak };
}

export function detectTechnologies(merged) {
  const detected = [];
  for (const signature of SIGNATURES) {
    const { strong, weak } = collectHits(signature, merged);
    let confidence;
    if (strong.length >= 1) confidence = 100;
    else if (weak.length >= 2) confidence = 95;
    else if (weak.length === 1) confidence = 90;
    else continue;

    const representative = strong[0] || weak[0];
    detected.push({
      name: signature.name,
      category: signature.category,
      confidence,
      evidence: representative.evidence,
      source: representative.source,
    });
  }
  return detected.sort((a, b) => b.confidence - a.confidence);
}
