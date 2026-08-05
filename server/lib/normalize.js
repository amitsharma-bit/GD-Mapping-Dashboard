export function normalizeDomain(input) {
  if (!input) return '';
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '');
  d = d.replace(/^www\./, '');
  d = d.split('/')[0];
  d = d.split('?')[0];
  return d.replace(/\/+$/, '');
}

export function dedupeDomains(domains) {
  const seen = new Set();
  const out = [];
  for (const raw of domains) {
    const d = normalizeDomain(raw);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

// "automotive"/"auto" standalone matter here as much as "motors"/"group" do - without
// them, two unrelated groups that both just happen to say "Automotive" in their name
// (e.g. "Sonic Automotive" vs "Battlefield Automotive") share a token and namesLikelyMatch
// below wrongly treats that as an alias match. Verified live: this caused a real false
// positive (100% confidence MAP to the wrong HubSpot group) before this fix.
const LEGAL_SUFFIXES = /\b(inc|llc|ltd|corp|corporation|co|company|group|automotive group|auto group|autogroup|automotive|auto|motors|motor group|dealerships?)\.?\b/gi;

export function normalizeCompanyName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Treats aliases like "Lithia" / "Lithia Motors" / "Lithia Motors Inc." as the same
// group: true if normalized names are identical, or share enough significant tokens
// (words > 2 chars) relative to the shorter name.
export function namesLikelyMatch(a, b) {
  const normA = normalizeCompanyName(a);
  const normB = normalizeCompanyName(b);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  const tokensA = normA.split(' ').filter((t) => t.length > 2);
  const tokensB = normB.split(' ').filter((t) => t.length > 2);
  if (!tokensA.length || !tokensB.length) return false;
  const shared = tokensA.filter((t) => tokensB.includes(t));
  return shared.length / Math.min(tokensA.length, tokensB.length) >= 0.5;
}
