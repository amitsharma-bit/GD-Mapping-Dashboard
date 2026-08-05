import React, { useState } from 'react';

const COLUMN_CATEGORIES = [
  ['website_provider', 'Website Provider'],
  ['chat', 'Chat'],
  ['reputation', 'Reputation'],
  ['crm', 'CRM'],
  ['scheduling', 'Service Scheduler'],
  ['ims', 'IMS'],
  ['dms', 'DMS'],
  ['analytics', 'Analytics'],
];

const DETAIL_ONLY_CATEGORIES = [
  ['inventory', 'Inventory'],
  ['digital_retail', 'Digital Retail'],
  ['other', 'Other'],
];

function ConfidenceBadge({ value }) {
  const cls = value >= 100 ? 'badge-success' : value >= 95 ? 'badge-info' : value >= 90 ? 'badge-warning' : 'badge-neutral';
  return <span className={`badge ${cls}`}>{value}</span>;
}

function TechChips({ names }) {
  if (!names?.length) return <span className="muted">Not Detected</span>;
  return (
    <div className="chip-row">
      {names.map((name) => (
        <span key={name} className="tech-chip">
          {name}
        </span>
      ))}
    </div>
  );
}

function DetailPanel({ result }) {
  const [showJson, setShowJson] = useState(false);
  return (
    <tr>
      <td colSpan={COLUMN_CATEGORIES.length + 1} style={{ padding: 0 }}>
        <div className="detail-panel fade-in">
          <div className="detail-facts">
            <div>
              <span className="detail-fact-label">Location</span>
              <span className="detail-fact-value">{[result.state, result.country].filter(Boolean).join(', ') || '—'}</span>
            </div>
            <div>
              <span className="detail-fact-label">US Dealership</span>
              <span className="detail-fact-value">
                {result.is_us_dealership ? 'Yes' : `No${result.status ? ` (${result.status})` : ''}`}
              </span>
            </div>
            <div>
              <span className="detail-fact-label">Crawl</span>
              <span className="detail-fact-value">
                {result.crawl_summary.pages_crawled} pages · {result.crawl_summary.scripts_analyzed} scripts ·{' '}
                {result.crawl_summary.external_domains} external domains
              </span>
            </div>
            {DETAIL_ONLY_CATEGORIES.map(([key, label]) => (
              <div key={key}>
                <span className="detail-fact-label">{label}</span>
                <TechChips names={result.categories[key]} />
              </div>
            ))}
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  {['Technology', 'Category', 'Confidence', 'Detection Method', 'Evidence', 'Source'].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.detected_technologies.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No technologies detected from verifiable evidence.
                    </td>
                  </tr>
                )}
                {result.detected_technologies.map((t, i) => (
                  <tr key={`${t.name}-${i}`} className={`row-hover${i % 2 === 1 ? ' zebra' : ''}`}>
                    <td>{t.name}</td>
                    <td>{t.category}</td>
                    <td>
                      <ConfidenceBadge value={t.confidence} />
                    </td>
                    <td>{t.method}</td>
                    <td style={{ maxWidth: 280 }}>{t.evidence}</td>
                    <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <a href={t.source} target="_blank" rel="noreferrer" className="link-external">
                        {t.source}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => setShowJson((v) => !v)}>
            {showJson ? 'Hide raw JSON' : 'View raw JSON'}
          </button>
          {showJson && <pre className="raw-json">{JSON.stringify(result, null, 2)}</pre>}
        </div>
      </td>
    </tr>
  );
}

export default function TechResultsTable({ results }) {
  const [expanded, setExpanded] = useState(null);
  if (!results.length) return null;

  return (
    <div className="table-container fade-in">
      <table className="data-table tech-table">
        <colgroup>
          <col style={{ width: '16%' }} />
          {COLUMN_CATEGORIES.map(([key]) => (
            <col key={key} style={{ width: '10.5%' }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th>Company Name</th>
            {COLUMN_CATEGORIES.map(([key, label]) => (
              <th key={key}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((result, i) => {
            const isExpanded = expanded === result.domain;
            if (result.error) {
              return (
                <tr key={result.domain} className={`row-hover${i % 2 === 1 ? ' zebra' : ''}`}>
                  <td>{result.domain}</td>
                  <td colSpan={COLUMN_CATEGORIES.length} className="error-text">
                    {result.reason}
                  </td>
                </tr>
              );
            }
            return (
              <React.Fragment key={result.domain}>
                <tr className={`row-hover${i % 2 === 1 ? ' zebra' : ''}`}>
                  <td>
                    <button onClick={() => setExpanded(isExpanded ? null : result.domain)} className="link-button">
                      {result.company_name || result.domain}
                    </button>
                    <div className="domain-sub">{result.domain}</div>
                  </td>
                  {COLUMN_CATEGORIES.map(([key]) => (
                    <td key={key}>
                      <TechChips names={result.categories[key]} />
                    </td>
                  ))}
                </tr>
                {isExpanded && <DetailPanel result={result} />}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
