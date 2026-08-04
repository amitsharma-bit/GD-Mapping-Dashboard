// Regex-based extraction of the structural evidence types the tech-detection rules
// care about: script/iframe URLs and inline script/JSON-LD content. Deliberately not a
// full HTML parser - these patterns matched cleanly against real rendered dealer sites
// in testing, and a full DOM parser would be overkill for "does this substring appear".

const SCRIPT_SRC_RE = /<script[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi;
const IFRAME_SRC_RE = /<iframe[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi;
const SCRIPT_BLOCK_RE = /<script([^>]*)>([\s\S]*?)<\/script>/gi;

export function extractPageSignals(rawHtml) {
  const scriptSrcs = [...(rawHtml || '').matchAll(SCRIPT_SRC_RE)].map((m) => m[1]);
  const iframeSrcs = [...(rawHtml || '').matchAll(IFRAME_SRC_RE)].map((m) => m[1]);

  const inlineScripts = [];
  const jsonLd = [];
  for (const [, attrs, content] of (rawHtml || '').matchAll(SCRIPT_BLOCK_RE)) {
    if (/\ssrc=/.test(attrs)) continue; // external script, already captured above
    if (/application\/ld\+json/i.test(attrs)) {
      try {
        const parsed = JSON.parse(content.trim());
        jsonLd.push(...(Array.isArray(parsed) ? parsed : [parsed]));
      } catch {
        // malformed JSON-LD on the page itself - not our bug, just skip it
      }
    } else if (content.trim()) {
      inlineScripts.push(content);
    }
  }

  return { scriptSrcs, iframeSrcs, inlineScripts, jsonLd };
}

export function mergeSignals(pages) {
  const merged = { scriptSrcs: [], iframeSrcs: [], inlineScripts: [], jsonLd: [], metadataEntries: [], pageUrls: [] };
  for (const page of pages) {
    const signals = extractPageSignals(page.rawHtml);
    merged.scriptSrcs.push(...signals.scriptSrcs.map((src) => ({ src, pageUrl: page.url })));
    merged.iframeSrcs.push(...signals.iframeSrcs.map((src) => ({ src, pageUrl: page.url })));
    merged.inlineScripts.push(...signals.inlineScripts.map((content) => ({ content, pageUrl: page.url })));
    merged.jsonLd.push(...signals.jsonLd.map((data) => ({ data, pageUrl: page.url })));
    merged.metadataEntries.push({ metadata: page.metadata || {}, pageUrl: page.url });
    merged.pageUrls.push(page.url);
  }
  return merged;
}
