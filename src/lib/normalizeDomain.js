// Mirrors server/lib/normalize.js's normalizeDomain - duplicated rather than imported
// so the client bundle never reaches into server/ code. Strips protocol, www, path,
// query string and trailing slashes: "https://www.example.com/foo/" -> "example.com".
export function normalizeDomain(input) {
  if (!input) return '';
  let d = String(input).trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '');
  d = d.replace(/^www\./, '');
  d = d.split('/')[0];
  d = d.split('?')[0];
  return d.replace(/\/+$/, '');
}
