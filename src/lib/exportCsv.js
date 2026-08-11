import * as XLSX from 'xlsx';

const COLUMNS = [
  ['input_company_name', 'Company Name'],
  ['verified_company_name', 'Verified Company Name'],
  ['domain', 'Domain'],
  ['input_city', 'City'],
  ['input_state', 'State'],
  ['dealer_group', 'Detected Group'],
  ['hubspot_group_name', 'HubSpot Group'],
  ['hubspot_group_record_id', 'HubSpot Record ID'],
  ['match_type', 'Match Type'],
  ['recommendation', 'Recommendation'],
  ['confidence', 'Confidence'],
  ['owner', 'Owner'],
  ['dealer_principal', 'Dealer Principal'],
  ['parent_company', 'Parent Company'],
  ['acquisitionText', 'Acquisition'],
  ['reason', 'Reason'],
  ['sourcesText', 'Sources'],
  ['research_timestamp', 'Research Date'],
];

function escapeCell(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function withDerivedFields(row) {
  const acquisition = row.acquisition
    ? [row.acquisition.previous_group, row.acquisition.current_group, row.acquisition.date].filter(Boolean).join(' -> ')
    : '';
  return { ...row, acquisitionText: acquisition, sourcesText: (row.sources || []).join(' | ') };
}

export function downloadResultsCsv(results, filename = 'dealership-group-mapping.csv') {
  const lines = [COLUMNS.map(([, label]) => escapeCell(label)).join(',')];
  for (const row of results) {
    const enriched = withDerivedFields(row);
    lines.push(COLUMNS.map(([key]) => escapeCell(enriched[key])).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadResultsExcel(results, filename = 'dealership-group-mapping.xlsx') {
  const rows = results.map((row) => {
    const enriched = withDerivedFields(row);
    const out = {};
    for (const [key, label] of COLUMNS) out[label] = enriched[key] ?? '';
    return out;
  });
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Mapping Results');
  XLSX.writeFile(workbook, filename);
}
