const COLUMNS = [
  'domain',
  'company_name',
  'company_record_id',
  'dealer_group',
  'hubspot_group_found',
  'hubspot_group_record_id',
  'recommendation',
  'confidence',
  'reason',
];

function escapeCell(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function downloadResultsCsv(results, filename = 'dealership-group-mapping.csv') {
  const lines = [COLUMNS.join(',')];
  for (const row of results) {
    lines.push(COLUMNS.map((c) => escapeCell(row[c])).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
