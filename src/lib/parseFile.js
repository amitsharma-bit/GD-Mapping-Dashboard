import * as XLSX from 'xlsx';

const DOMAIN_HEADER_NAMES = ['domain', 'website', 'url', 'site'];

export async function parseDomainsFromFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!rows.length) return [];

  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const domainCol = header.findIndex((h) => DOMAIN_HEADER_NAMES.includes(h));

  const dataRows = domainCol === -1 ? rows : rows.slice(1);
  const col = domainCol === -1 ? 0 : domainCol;

  return dataRows
    .map((row) => String(row[col] || '').trim())
    .filter(Boolean);
}

export function parseDomainsFromText(text) {
  return text
    .split(/[\n,;]+/)
    .map((d) => d.trim())
    .filter(Boolean);
}
