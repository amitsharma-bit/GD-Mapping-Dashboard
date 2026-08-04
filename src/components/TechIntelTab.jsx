import React, { useState } from 'react';
import { scanTechStack } from '../lib/api.js';

const CATEGORY_LABELS = {
  chat: 'Chat',
  website_provider: 'Website Provider',
  crm: 'CRM',
  inventory: 'Inventory',
  digital_retail: 'Digital Retail',
  reputation: 'Reputation',
  analytics: 'Analytics',
  scheduling: 'Scheduling',
  other: 'Other',
};

function ConfidenceBadge({ value }) {
  const color = value >= 100 ? '#16a34a' : value >= 95 ? '#2563eb' : '#d97706';
  return (
    <span style={{ color: '#fff', background: color, padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>{value}</span>
  );
}

export default function TechIntelTab() {
  const [domain, setDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [showJson, setShowJson] = useState(false);
  const [error, setError] = useState(null);

  async function handleScan() {
    if (!domain.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await scanTechStack(domain.trim());
      setResult(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div>
      <p style={{ color: '#555' }}>
        Crawls a dealership website and identifies its technology stack (chat, CRM, website provider, analytics,
        and more) from verifiable evidence only — no guessing.
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          placeholder="abcford.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleScan()}
          style={{ flex: 1, padding: 8, fontSize: 14 }}
        />
        <button onClick={handleScan} disabled={loading || !domain.trim()}>
          {loading ? 'Scanning…' : 'Scan'}
        </button>
      </div>

      {loading && <p style={{ color: '#555', marginTop: 12 }}>Crawling site and analyzing scripts — this can take up to a minute…</p>}
      {error && <p style={{ color: '#b91c1c', marginTop: 12 }}>{error}</p>}

      {result && result.error && (
        <p style={{ color: '#b91c1c', marginTop: 12 }}>{result.reason}</p>
      )}

      {result && !result.error && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 16 }}>
            <div>
              <strong>Company</strong>
              <div>{result.company_name || '—'}</div>
            </div>
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
          </div>

          {!result.is_us_dealership && (
            <p style={{ background: '#fef3c7', padding: 8, borderRadius: 4 }}>
              This site does not appear to be a US dealership. Technology results below are still shown for reference.
            </p>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Technology', 'Category', 'Confidence', 'Evidence', 'Source'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 8 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.detected_technologies.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 8, color: '#555' }}>
                    No technologies detected from verifiable evidence.
                  </td>
                </tr>
              )}
              {result.detected_technologies.map((t, i) => (
                <tr key={`${t.name}-${i}`}>
                  <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{t.name}</td>
                  <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{CATEGORY_LABELS[t.category] || t.category}</td>
                  <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
                    <ConfidenceBadge value={t.confidence} />
                  </td>
                  <td style={{ padding: 8, borderBottom: '1px solid #eee', maxWidth: 320 }}>{t.evidence}</td>
                  <td style={{ padding: 8, borderBottom: '1px solid #eee', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <a href={t.source} target="_blank" rel="noreferrer">
                      {t.source}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button style={{ marginTop: 12 }} onClick={() => setShowJson((v) => !v)}>
            {showJson ? 'Hide raw JSON' : 'View raw JSON'}
          </button>
          {showJson && (
            <pre style={{ background: '#f5f5f5', padding: 12, overflow: 'auto', marginTop: 8 }}>
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
