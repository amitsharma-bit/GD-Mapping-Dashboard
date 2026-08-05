// Regex-based extraction of the structural evidence types the tech-detection rules
// care about. Deliberately not a full HTML parser - these patterns matched cleanly
// against real rendered dealer sites in testing, and a full DOM parser would be overkill
// for "does this substring appear".

const SCRIPT_SRC_RE = /<script[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi;
const IFRAME_SRC_RE = /<iframe[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi;
const SCRIPT_BLOCK_RE = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
const FORM_BLOCK_RE = /<form\b[^>]*>[\s\S]*?<\/form>/gi;
const LINK_TAG_RE = /<link\b[^>]*>/gi;

export function extractPageSignals(rawHtml) {
  const html = rawHtml || '';
  const scriptSrcs = [...html.matchAll(SCRIPT_SRC_RE)].map((m) => m[1]);
  const iframeSrcs = [...html.matchAll(IFRAME_SRC_RE)].map((m) => m[1]);

  const inlineScripts = [];
  const jsonLd = [];
  for (const [, attrs, content] of html.matchAll(SCRIPT_BLOCK_RE)) {
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

  // Lead-capture / scheduler forms often POST straight to the vendor's own endpoint, or
  // carry a hidden input naming the vendor (e.g. a CRM's lead-routing field), even when
  // there's no visible script/iframe for it - a real, previously untapped evidence source
  // for CRM and Service Scheduler detection specifically. Capturing the whole form block
  // (not just its action= attribute) is what catches the hidden-input case.
  const formBlocks = [];
  for (const [block] of html.matchAll(FORM_BLOCK_RE)) {
    const actionMatch = block.match(/\baction=["']([^"']+)["']/i);
    formBlocks.push({ html: block, action: actionMatch ? actionMatch[1] : null });
  }

  // A vendor's companion CSS loading from their own CDN, independent of how the JS loads.
  const stylesheetHrefs = [];
  for (const tag of html.matchAll(LINK_TAG_RE)) {
    if (!/\brel=["']stylesheet["']/i.test(tag[0])) continue;
    const match = tag[0].match(/\bhref=["']([^"']+)["']/i);
    if (match) stylesheetHrefs.push(match[1]);
  }

  return { scriptSrcs, iframeSrcs, inlineScripts, jsonLd, formBlocks, stylesheetHrefs };
}

export function mergeSignals(pages) {
  const merged = {
    scriptSrcs: [],
    iframeSrcs: [],
    inlineScripts: [],
    jsonLd: [],
    metadataEntries: [],
    formBlocks: [],
    stylesheetHrefs: [],
    linkHrefs: [],
    pageTexts: [],
    pageUrls: [],
  };
  for (const page of pages) {
    const signals = extractPageSignals(page.rawHtml);
    merged.scriptSrcs.push(...signals.scriptSrcs.map((src) => ({ src, pageUrl: page.url })));
    merged.iframeSrcs.push(...signals.iframeSrcs.map((src) => ({ src, pageUrl: page.url })));
    merged.inlineScripts.push(...signals.inlineScripts.map((content) => ({ content, pageUrl: page.url })));
    merged.jsonLd.push(...signals.jsonLd.map((data) => ({ data, pageUrl: page.url })));
    merged.metadataEntries.push({ metadata: page.metadata || {}, pageUrl: page.url });
    merged.formBlocks.push(...signals.formBlocks.map((f) => ({ ...f, pageUrl: page.url })));
    merged.stylesheetHrefs.push(...signals.stylesheetHrefs.map((href) => ({ href, pageUrl: page.url })));
    // Firecrawl already parses anchor hrefs into page.links - no need to regex them
    // ourselves. A plain "Schedule Service" link out to a vendor's hosted booking page,
    // or a footer "Employee Login" link to a DMS/CRM portal, is real (if weaker) evidence.
    merged.linkHrefs.push(...(page.links || []).map((href) => ({ href, pageUrl: page.url })));
    // Firecrawl's markdown format - a clean, tag-free reading of the page. Used
    // specifically for footer "Powered by X" / "Designed by X" credit-line detection,
    // which is plain text and wouldn't appear in any of the URL-bearing buckets above.
    if (page.markdown) merged.pageTexts.push({ text: page.markdown, pageUrl: page.url });
    merged.pageUrls.push(page.url);
  }
  return merged;
}
