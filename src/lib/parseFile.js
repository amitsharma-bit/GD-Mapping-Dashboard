import * as XLSX from 'xlsx';
import { normalizeDomain } from './normalizeDomain.js';

// Header synonyms per the input spec - column order never matters, and any of these
// variants is recognized for each field.
const HEADER_SYNONYMS = {
  company_name: ['company name', 'company', 'dealership', 'dealer name'],
  domain: ['company domain', 'domain', 'website', 'website domain', 'url', 'site'],
  city: ['city', 'location city'],
  state: ['state', 'state code', 'state/province'],
};

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function detectColumns(headerRow) {
  const headers = headerRow.map(normalizeHeader);
  const columns = {};
  for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
    const idx = headers.findIndex((h) => synonyms.includes(h));
    if (idx !== -1) columns[field] = idx;
  }
  return columns;
}

function rowsToRecords(rows) {
  if (!rows.length) return [];
  const columns = detectColumns(rows[0]);
  const hasHeader = columns.domain !== undefined || columns.company_name !== undefined;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const domainCol = columns.domain !== undefined ? columns.domain : 0;

  return dataRows
    .map((row) => ({
      company_name: columns.company_name !== undefined ? String(row[columns.company_name] || '').trim() || null : null,
      domain: normalizeDomain(row[domainCol]),
      city: columns.city !== undefined ? String(row[columns.city] || '').trim() || null : null,
      state: columns.state !== undefined ? String(row[columns.state] || '').trim() || null : null,
    }))
    .filter((r) => r.company_name || r.domain);
}

export async function parseRecordsFromFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  return rowsToRecords(rows);
}

function splitLine(line) {
  // Accept comma- or tab-separated paste; plain single-value lines (just a domain)
  // fall out naturally as a one-element array.
  return line.includes('\t') ? line.split('\t') : line.split(',');
}

export function parseRecordsFromText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const rows = lines.map(splitLine);
  // A single bare-domain-per-line paste (the original behavior) has exactly one
  // column and no header row to detect - rowsToRecords handles that fine since
  // detectColumns finds no known header and domainCol falls back to column 0.
  return rowsToRecords(rows);
}

// Backward-compatible helpers - still used anywhere only a plain domain list matters.
export async function parseDomainsFromFile(file) {
  const records = await parseRecordsFromFile(file);
  return records.map((r) => r.domain).filter(Boolean);
}

export function parseDomainsFromText(text) {
  return parseRecordsFromText(text).map((r) => r.domain).filter(Boolean);
}
