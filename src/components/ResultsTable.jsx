import React from 'react';

const BADGE_CLASSES = {
  MAP: 'badge-success',
  CREATE_NEW_GROUP: 'badge-info',
  REVIEW: 'badge-warning',
};

export default function ResultsTable({ results }) {
  if (!results.length) return null;
  return (
    <div className="table-container fade-in">
      <table className="data-table">
        <thead>
          <tr>
            {['Domain', 'Company', 'Dealer Group', 'HubSpot Match', 'Recommendation', 'Confidence', 'Reason'].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <tr key={r.domain} className={`row-hover${i % 2 === 1 ? ' zebra' : ''}`}>
              <td>{r.domain}</td>
              <td>{r.company_name || '—'}</td>
              <td>{r.dealer_group || '—'}</td>
              <td>{r.hubspot_group_found ? `#${r.hubspot_group_record_id}` : '—'}</td>
              <td>
                <span className={`badge ${BADGE_CLASSES[r.recommendation] || 'badge-neutral'}`}>{r.recommendation}</span>
              </td>
              <td>{r.confidence}</td>
              <td style={{ maxWidth: 360 }}>{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
