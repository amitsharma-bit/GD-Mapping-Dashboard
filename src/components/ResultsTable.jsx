import React from 'react';

const BADGE_COLORS = {
  MAP: '#16a34a',
  CREATE_NEW_GROUP: '#2563eb',
  REVIEW: '#d97706',
};

export default function ResultsTable({ results }) {
  if (!results.length) return null;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
      <thead>
        <tr>
          {['Domain', 'Company', 'Dealer Group', 'HubSpot Match', 'Recommendation', 'Confidence', 'Reason'].map((h) => (
            <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 8 }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {results.map((r) => (
          <tr key={r.domain}>
            <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{r.domain}</td>
            <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{r.company_name || '—'}</td>
            <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{r.dealer_group || '—'}</td>
            <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
              {r.hubspot_group_found ? `#${r.hubspot_group_record_id}` : '—'}
            </td>
            <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
              <span
                style={{
                  color: '#fff',
                  background: BADGE_COLORS[r.recommendation] || '#6b7280',
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: 12,
                }}
              >
                {r.recommendation}
              </span>
            </td>
            <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{r.confidence}</td>
            <td style={{ padding: 8, borderBottom: '1px solid #eee', maxWidth: 360 }}>{r.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
