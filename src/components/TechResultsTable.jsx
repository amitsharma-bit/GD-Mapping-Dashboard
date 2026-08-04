import React, { useState } from 'react';

const COLUMN_CATEGORIES = [
  ['website_provider', 'Website Provider'],
  ['chat', 'Chat'],
  ['reputation', 'Reputation'],
  ['crm', 'CRM'],
  ['scheduling', 'Service Scheduler'],
  ['analytics', 'Analytics'],
];

const DETAIL_ONLY_CATEGORIES = [
  ['inventory', 'Inventory'],
  ['digital_retail', 'Digital Retail'],
  ['other', 'Other'],
];

function ConfidenceBadge({ value }) {
  const color = value >= 100 ? '#16a34a' : value >= 95 ? '#2563eb' : '#d97706';
  return (
    <span style={{ color: '#fff', background: color, padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>{value}</span>
  );
}

function DetailPanel({ result }) {
  const [showJson, setShowJson] = useState(false);
  return (
    <tr>
      <td colSpan={COLUMN_CATEGORIES.length + 1} style={{ padding: 16, background: '#fafafa', borderBottom: '1px solid #eee' }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <strong>Location</strong>
            <div>{[result.state, result.country].filter(Boolean).join(', ') || '—'}</div>
          </div>
          <div>
            <strong>US Dealership</strong>
            <div>{result.is_us_dealership ? 'Yes' : `No${result.status ? ` (${result.status})` : ''}`}</div>
          </div>
          <div>
            <strong>Crawl</strong>
            <div>
              {result.crawl_summary.pages_crawled} pages · {result.crawl_summary.scripts_analyzed} scripts ·{' '}
              {result.crawl_summary.external_domains} external domains
            </div>
          </div>
          {DETAIL_ONLY_CATEGORIES.map(([key, label]) => (
            <div key={key}>
              <strong>{label}</strong>
              <div>{result.categories[key]?.join(', ') || '—'}</div>
            </div>
          ))}
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Technology', 'Category', 'Confidence', 'Evidence', 'Source'].map((h) => (
                <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6, fontSize: 13 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.detected_technologies.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 6, color: '#555' }}>No technologies detected from verifiable evidence.</td>
              </tr>
            )}
            {result.detected_technologies.map((t, i) => (
              <tr key={`${t.name}-${i}`}>
                <td style={{ padding: 6, fontSize: 13 }}>{t.name}</td>
                <td style={{ padding: 6, fontSize: 13 }}>{t.category}</td>
                <td style={{ padding: 6 }}><ConfidenceBadge value={t.confidence} /></td>
                <td style={{ padding: 6, fontSize: 13, maxWidth: 320 }}>{t.evidence}</td>
                <td style={{ padding: 6, fontSize: 13, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <a href={t.source} target="_blank" rel="noreferrer">{t.source}</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button style={{ marginTop: 12 }} onClick={() => setShowJson((v) => !v)}>
          {showJson ? 'Hide raw JSON' : 'View raw JSON'}
        </button>
        {showJson && <pre style={{ background: '#f5f5f5', padding: 12, overflow: 'auto', marginTop: 8 }}>{JSON.stringify(result, null, 2)}</pre>}
      </td>
    </tr>
  );
}

export default function TechResultsTable({ results }) {
  const [expanded, setExpanded] = useState(null);
  if (!results.length) return null;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 8 }}>Company Name</th>
          {COLUMN_CATEGORIES.map(([key, label]) => (
            <th key={key} style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 8 }}>{label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {results.map((result) => {
          const isExpanded = expanded === result.domain;
          if (result.error) {
            return (
              <tr key={result.domain}>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{result.domain}</td>
                <td colSpan={COLUMN_CATEGORIES.length} style={{ padding: 8, borderBottom: '1px solid #eee', color: '#b91c1c' }}>
                  {result.reason}
                </td>
              </tr>
            );
          }
          return (
            <React.Fragment key={result.domain}>
              <tr>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
                  <button
                    onClick={() => setExpanded(isExpanded ? null : result.domain)}
                    style={{ background: 'none', border: 'none', padding: 0, color: '#2563eb', cursor: 'pointer', textDecoration: 'underline', font: 'inherit' }}
                  >
                    {result.company_name || result.domain}
                  </button>
                  <div style={{ fontSize: 12, color: '#888' }}>{result.domain}</div>
                </td>
                {COLUMN_CATEGORIES.map(([key]) => (
                  <td key={key} style={{ padding: 8, borderBottom: '1px solid #eee' }}>
                    {result.categories[key]?.join(', ') || '—'}
                  </td>
                ))}
              </tr>
              {isExpanded && <DetailPanel result={result} />}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
