import React, { useEffect, useState } from 'react';
import { searchHubspotGroups } from '../lib/api.js';

const RECOMMENDATION_BADGES = {
  MAP: 'badge-success',
  CREATE_NEW_GROUP: 'badge-info',
  REVIEW: 'badge-warning',
  NO_GROUP_FOUND: 'badge-neutral',
};

const MATCH_TYPE_LABELS = {
  EXACT_MATCH: 'Exact',
  NORMALIZED_MATCH: 'Normalized',
  ALIAS_MATCH: 'Alias',
  OWNERSHIP_MATCH: 'Ownership',
  ACQUISITION_MATCH: 'Acquisition',
  POSSIBLE_MATCH: 'Possible',
  NO_MATCH: 'No match',
};

function ConfidenceBadge({ value }) {
  const cls = value >= 95 ? 'badge-success' : value >= 80 ? 'badge-info' : value >= 50 ? 'badge-warning' : 'badge-danger';
  return <span className={`badge ${cls}`}>{value}</span>;
}

function RecommendationBadge({ value }) {
  return <span className={`badge ${RECOMMENDATION_BADGES[value] || 'badge-neutral'}`}>{value?.replace(/_/g, ' ') || '—'}</span>;
}

function SourceLink({ url }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="link-external">
      {url}
    </a>
  );
}

function OwnershipChain({ result }) {
  const steps = [
    result.verified_company_name || result.input_company_name || result.domain,
    result.owner || result.dealer_principal,
    result.parent_company,
    result.dealer_group,
    result.related_dealerships?.length ? `${result.related_dealerships.length} related dealership(s)` : null,
  ].filter(Boolean);
  if (steps.length < 2) return <p className="muted">Not enough evidence to build an ownership chain.</p>;
  return (
    <div className="ownership-chain">
      {steps.map((step, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="chain-arrow">↓</span>}
          <span className="chain-node">{step}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

function HubspotOverride({ result, onOverrideGroup }) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setOptions([]);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      const res = await searchHubspotGroups(query).catch(() => []);
      setOptions(res);
      setSearching(false);
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div>
      <input
        type="text"
        className="input"
        placeholder="Search HubSpot companies by name to override…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {searching && <div className="muted" style={{ marginTop: 4 }}>Searching…</div>}
      {options.length > 0 && (
        <div className="override-options">
          {options.map((o) => (
            <button
              key={o.id}
              className="override-option"
              onClick={() => onOverrideGroup(result.domain, o.properties?.dealership_group_name || o.properties?.name, o.id)}
            >
              {o.properties?.name} {o.properties?.dealership_group_name ? `— group: ${o.properties.dealership_group_name}` : ''}
              <span className="muted"> (#{o.id})</span>
            </button>
          ))}
        </div>
      )}
      {result.user_override_group_name && (
        <div className="notice-warning" style={{ marginTop: 8 }}>
          Overridden to: <strong>{result.user_override_group_name}</strong>
          {result.user_override_group_id ? ` (#${result.user_override_group_id})` : ''}
        </div>
      )}
    </div>
  );
}

function DetailPanel({ result, onRerun, onApprove, onReject, onMarkReview, onOverrideGroup }) {
  const [showJson, setShowJson] = useState(false);
  return (
    <tr>
      <td colSpan={13} style={{ padding: 0 }}>
        <div className="detail-panel fade-in">
          <div className="detail-facts">
            <div>
              <span className="detail-fact-label">Input Company</span>
              <span className="detail-fact-value">{result.input_company_name || '—'}</span>
            </div>
            <div>
              <span className="detail-fact-label">Verified Company</span>
              <span className="detail-fact-value">{result.verified_company_name || '—'}</span>
            </div>
            {result.name_difference_reason && (
              <div>
                <span className="detail-fact-label">Why the name differs</span>
                <span className="detail-fact-value">{result.name_difference_reason}</span>
              </div>
            )}
            <div>
              <span className="detail-fact-label">Domain / City / State</span>
              <span className="detail-fact-value">
                {result.domain} · {result.input_city || '—'}, {result.input_state || '—'}
              </span>
            </div>
            <div>
              <span className="detail-fact-label">Brand / OEM</span>
              <span className="detail-fact-value">{result.brand_oem || '—'}</span>
            </div>
            <div>
              <span className="detail-fact-label">Dealer Principal / President / CEO</span>
              <span className="detail-fact-value">{[result.dealer_principal, result.president_ceo].filter(Boolean).join(' · ') || '—'}</span>
            </div>
            <div>
              <span className="detail-fact-label">Official Group Website</span>
              <span className="detail-fact-value">
                {result.official_group_website ? <SourceLink url={result.official_group_website} /> : '—'}
                {result.group_site_confirms_dealership ? ' (confirmed listing)' : ''}
              </span>
            </div>
            <div>
              <span className="detail-fact-label">Research Mode / Timestamp</span>
              <span className="detail-fact-value">
                {result.research_mode || '—'} · {result.research_timestamp ? new Date(result.research_timestamp).toLocaleString() : '—'}
              </span>
            </div>
          </div>

          <div className="detail-fact-label" style={{ marginBottom: 6 }}>
            Ownership Chain
          </div>
          <OwnershipChain result={result} />

          {result.acquisition && (
            <div className="notice-warning" style={{ marginTop: 12 }}>
              Acquisition: {result.acquisition.previous_group || '?'} → {result.acquisition.current_group || '?'}
              {result.acquisition.date ? ` (${result.acquisition.date})` : ''}
              {result.acquisition.acquirer ? ` — acquired by ${result.acquisition.acquirer}` : ''}
            </div>
          )}

          {result.conflict_detected && (result.conflicts || []).length > 0 && (
            <div className="notice-warning" style={{ marginTop: 12 }}>
              <strong>CONFLICT DETECTED</strong>
              {result.conflicts.map((c, i) => (
                <div key={i} style={{ marginTop: 6 }}>
                  Source A: {c.claim_a} (<SourceLink url={c.source_a} />) vs. Source B: {c.claim_b} (<SourceLink url={c.source_b} />)
                  {c.possible_reason ? ` — ${c.possible_reason}` : ''}
                </div>
              ))}
            </div>
          )}

          {result.related_dealerships?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="detail-fact-label">Related Dealerships</div>
              <div className="chip-row">
                {result.related_dealerships.map((d, i) => (
                  <span key={i} className="tech-chip">
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <div className="detail-fact-label" style={{ marginBottom: 6 }}>
              Evidence ({result.evidence?.length || 0})
            </div>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    {['Tier', 'Claim', 'Source'].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(!result.evidence || result.evidence.length === 0) && (
                    <tr>
                      <td colSpan={3} className="muted">
                        No verifiable evidence collected.
                      </td>
                    </tr>
                  )}
                  {(result.evidence || []).map((e, i) => (
                    <tr key={i} className={`row-hover${i % 2 === 1 ? ' zebra' : ''}`}>
                      <td>
                        <span className="badge badge-neutral">{e.source_tier}</span>
                      </td>
                      <td>{e.claim}</td>
                      <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <SourceLink url={e.url} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            <div>
              <div className="detail-fact-label">All Sources</div>
              {(result.sources || []).length ? (
                <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                  {result.sources.map((s, i) => (
                    <li key={i}>
                      <SourceLink url={s} />
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="muted">None</span>
              )}
            </div>
            <div>
              <div className="detail-fact-label">Search Queries Used</div>
              {(result.search_queries || []).length ? (
                <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                  {result.search_queries.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              ) : (
                <span className="muted">None</span>
              )}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="detail-fact-label" style={{ marginBottom: 6 }}>
              HubSpot Match
            </div>
            <p>
              Group: <strong>{result.hubspot_group_name || '—'}</strong>{' '}
              {result.hubspot_group_record_id ? `(#${result.hubspot_group_record_id})` : ''} — {MATCH_TYPE_LABELS[result.match_type] || result.match_type}
              {result.match_confidence ? ` (${result.match_confidence}%)` : ''}
            </p>
            <p className="muted" style={{ marginTop: -8 }}>
              {result.reason}
            </p>
            <HubspotOverride result={result} onOverrideGroup={onOverrideGroup} />
          </div>

          <div className="action-row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => onApprove(result.domain)}>
              Approve Mapping
            </button>
            <button className="btn btn-secondary" onClick={() => onMarkReview(result.domain)}>
              Mark for Review
            </button>
            <button className="btn btn-secondary" onClick={() => onReject(result.domain)}>
              Reject Mapping
            </button>
            <button className="btn btn-secondary" onClick={() => onRerun(result.domain)}>
              Re-run Research
            </button>
            <button className="btn btn-secondary" onClick={() => onRerun(result.domain, 'deep')}>
              Deep Research
            </button>
            {result.user_decision && (
              <span className={`badge ${result.user_decision === 'approved' ? 'badge-success' : result.user_decision === 'rejected' ? 'badge-danger' : 'badge-warning'}`}>
                {result.user_decision}
              </span>
            )}
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

export default function ResultsTable({ results, selected, onToggleSelect, onRerun, onApprove, onReject, onMarkReview, onOverrideGroup }) {
  const [expanded, setExpanded] = useState(null);
  if (!results.length) return null;

  return (
    <div className="table-container fade-in">
      <table className="data-table">
        <thead>
          <tr>
            <th></th>
            {['Company', 'Domain', 'City', 'State', 'Detected Group', 'HubSpot Group', 'Record ID', 'Match Type', 'Recommendation', 'Confidence', 'Owner', 'Status'].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const isExpanded = expanded === r.domain;
            return (
              <React.Fragment key={r.domain}>
                <tr className={`row-hover${i % 2 === 1 ? ' zebra' : ''}`}>
                  <td>
                    <input type="checkbox" checked={selected?.has(r.domain) || false} onChange={() => onToggleSelect(r.domain)} />
                  </td>
                  <td>
                    <button onClick={() => setExpanded(isExpanded ? null : r.domain)} className="link-button">
                      {r.verified_company_name || r.input_company_name || r.domain}
                    </button>
                  </td>
                  <td>{r.domain}</td>
                  <td>{r.input_city || '—'}</td>
                  <td>{r.input_state || '—'}</td>
                  <td>{r.user_override_group_name || r.dealer_group || '—'}</td>
                  <td>{r.hubspot_group_name || '—'}</td>
                  <td>{r.hubspot_group_record_id ? `#${r.hubspot_group_record_id}` : '—'}</td>
                  <td>
                    <span className="badge badge-neutral">{MATCH_TYPE_LABELS[r.match_type] || '—'}</span>
                  </td>
                  <td>
                    <RecommendationBadge value={r.recommendation} />
                  </td>
                  <td>
                    <ConfidenceBadge value={r.confidence || 0} />
                  </td>
                  <td>{r.owner || '—'}</td>
                  <td>
                    {r.status === 'FAILED' || r.error ? (
                      <span className="badge badge-danger">Failed</span>
                    ) : r.status === 'INVALID' ? (
                      <span className="badge badge-danger">Invalid</span>
                    ) : (
                      <span className="badge badge-neutral">{r.status || '—'}</span>
                    )}
                  </td>
                </tr>
                {isExpanded && (
                  <DetailPanel
                    result={r}
                    onRerun={onRerun}
                    onApprove={onApprove}
                    onReject={onReject}
                    onMarkReview={onMarkReview}
                    onOverrideGroup={onOverrideGroup}
                  />
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
