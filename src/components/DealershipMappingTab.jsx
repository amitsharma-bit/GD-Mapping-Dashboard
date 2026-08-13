import React, { useEffect, useMemo, useRef, useState } from 'react';
import ResultsTable from './ResultsTable.jsx';
import { parseRecordsFromFile, parseRecordsFromText } from '../lib/parseFile.js';
import { normalizeDomain } from '../lib/normalizeDomain.js';
import { processCompany } from '../lib/api.js';
import { downloadResultsCsv, downloadResultsExcel } from '../lib/exportCsv.js';

const STORAGE_KEY = 'gd-mapping-results';

const FILTERS = [
  ['all', 'All'],
  ['mapped', 'Mapped'],
  ['unmapped', 'Unmapped'],
  ['review', 'Needs Review'],
  ['create_new_group', 'Create New Group'],
  ['high_confidence', 'High Confidence'],
  ['low_confidence', 'Low Confidence'],
  ['acquisition', 'Acquisition Found'],
  ['independent', 'Independent'],
  ['conflict', 'Conflicting Evidence'],
  ['failed', 'Research Failed'],
];

const SORT_OPTIONS = [
  ['confidence', 'Confidence'],
  ['company', 'Company'],
  ['group', 'Group'],
  ['status', 'Status'],
  ['date', 'Research Date'],
];

function loadStoredResults() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function matchesFilter(r, filter) {
  switch (filter) {
    case 'mapped':
      return r.recommendation === 'MAP';
    case 'unmapped':
      return r.recommendation !== 'MAP';
    case 'review':
      return r.recommendation === 'REVIEW';
    case 'create_new_group':
      return r.recommendation === 'CREATE_NEW_GROUP';
    case 'high_confidence':
      return r.confidence >= 90;
    case 'low_confidence':
      return r.confidence > 0 && r.confidence < 70;
    case 'acquisition':
      return Boolean(r.acquisition);
    case 'independent':
      return Boolean(r.independently_owned);
    case 'conflict':
      return Boolean(r.conflict_detected);
    case 'failed':
      return r.status === 'FAILED' || Boolean(r.error);
    default:
      return true;
  }
}

function matchesSearch(r, query) {
  if (!query) return true;
  const haystack = [
    r.input_company_name,
    r.verified_company_name,
    r.domain,
    r.input_city,
    r.input_state,
    r.dealer_group,
    r.owner,
    r.hubspot_group_name,
    r.hubspot_group_record_id,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function sortResults(list, sortKey, sortDir) {
  const dir = sortDir === 'asc' ? 1 : -1;
  const sorted = [...list].sort((a, b) => {
    let av;
    let bv;
    switch (sortKey) {
      case 'confidence':
        av = a.confidence || 0;
        bv = b.confidence || 0;
        break;
      case 'group':
        av = (a.dealer_group || '').toLowerCase();
        bv = (b.dealer_group || '').toLowerCase();
        break;
      case 'status':
        av = a.recommendation || '';
        bv = b.recommendation || '';
        break;
      case 'date':
        av = a.research_timestamp || '';
        bv = b.research_timestamp || '';
        break;
      default:
        av = (a.verified_company_name || a.input_company_name || a.domain || '').toLowerCase();
        bv = (b.verified_company_name || b.input_company_name || b.domain || '').toLowerCase();
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
  return sorted;
}

function statsFor(results) {
  const list = Object.values(results);
  const stat = (pred) => list.filter(pred).length;
  return {
    total: list.length,
    completed: stat((r) => r.status === 'COMPLETED'),
    mapped: stat((r) => r.recommendation === 'MAP'),
    createNewGroup: stat((r) => r.recommendation === 'CREATE_NEW_GROUP'),
    review: stat((r) => r.recommendation === 'REVIEW'),
    noGroupFound: stat((r) => r.recommendation === 'NO_GROUP_FOUND'),
    invalid: stat((r) => r.status === 'INVALID'),
    failed: stat((r) => r.status === 'FAILED' || r.error),
  };
}

export default function DealershipMappingTab() {
  const [mode, setMode] = useState('single');
  const [researchMode, setResearchMode] = useState('standard');
  const [singleForm, setSingleForm] = useState({ company_name: '', domain: '', city: '', state: '' });
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [results, setResults] = useState(loadStoredResults);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [selected, setSelected] = useState(() => new Set());
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const stopRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
  }, [results]);

  function mergeResult(domain, incoming) {
    setResults((prev) => {
      const existing = prev[domain] || {};
      return {
        ...prev,
        [domain]: {
          ...incoming,
          user_decision: existing.user_decision || null,
          user_override_group_name: existing.user_override_group_name || null,
          user_override_group_id: existing.user_override_group_id || null,
        },
      };
    });
  }

  async function runRecord(record, runMode) {
    const domain = normalizeDomain(record.domain);
    if (!domain) {
      mergeResult(record.domain || '(missing domain)', {
        domain: record.domain || null,
        input_domain: record.domain || null,
        input_company_name: record.company_name || null,
        input_city: record.city || null,
        input_state: record.state || null,
        status: 'INVALID',
        recommendation: 'REVIEW',
        confidence: 0,
        reason: 'Missing or invalid Company Domain.',
        error: true,
      });
      return;
    }
    try {
      const result = await processCompany({
        domain,
        company_name: record.company_name || undefined,
        city: record.city || undefined,
        state: record.state || undefined,
        mode: runMode,
      });
      mergeResult(domain, result);
    } catch (err) {
      mergeResult(domain, {
        domain,
        input_domain: record.domain || null,
        input_company_name: record.company_name || null,
        input_city: record.city || null,
        input_state: record.state || null,
        status: 'FAILED',
        recommendation: 'REVIEW',
        confidence: 0,
        reason: `Request failed: ${err.message}`,
        error: true,
      });
    }
  }

  async function runBatch(records, { skipCompleted = true, runMode = researchMode } = {}) {
    const pending = skipCompleted
      ? records.filter((r) => {
          const domain = normalizeDomain(r.domain);
          const existing = domain ? results[domain] : null;
          return !existing || existing.status !== 'COMPLETED';
        })
      : records;
    setRunning(true);
    stopRef.current = false;
    setProgress({ done: 0, total: pending.length });
    for (let i = 0; i < pending.length; i += 1) {
      if (stopRef.current) break;
      await runRecord(pending[i], runMode);
      setProgress({ done: i + 1, total: pending.length });
    }
    setRunning(false);
  }

  async function handleRunSingle() {
    if (!singleForm.domain.trim() && !singleForm.company_name.trim()) return;
    await runBatch([singleForm], { skipCompleted: false });
  }

  async function handleRunBatch() {
    let records = [];
    if (mode === 'file' && file) records = await parseRecordsFromFile(file);
    else records = parseRecordsFromText(text);
    if (records.length) await runBatch(records);
  }

  function handleStop() {
    stopRef.current = true;
  }

  const resultList = useMemo(() => Object.values(results), [results]);
  const filteredSorted = useMemo(() => {
    const filtered = resultList.filter((r) => matchesFilter(r, filter) && matchesSearch(r, search));
    return sortResults(filtered, sortKey, sortDir);
  }, [resultList, filter, search, sortKey, sortDir]);

  const stats = useMemo(() => statsFor(results), [results]);

  function toggleSelect(domain) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const visibleDomains = filteredSorted.map((r) => r.domain);
      const allSelected = visibleDomains.every((d) => prev.has(d));
      const next = new Set(prev);
      if (allSelected) visibleDomains.forEach((d) => next.delete(d));
      else visibleDomains.forEach((d) => next.add(d));
      return next;
    });
  }

  function recordFor(domain) {
    const r = results[domain] || {};
    return { domain, company_name: r.input_company_name, city: r.input_city, state: r.input_state };
  }

  async function handleResearchSelected(runMode) {
    const records = [...selected].map(recordFor);
    if (records.length) await runBatch(records, { skipCompleted: false, runMode });
  }

  async function handleRetryFailed() {
    const failedDomains = resultList.filter((r) => r.status === 'FAILED' || r.error).map((r) => r.domain);
    const records = failedDomains.map(recordFor);
    if (records.length) await runBatch(records, { skipCompleted: false });
  }

  function handleMarkReviewSelected() {
    setResults((prev) => {
      const next = { ...prev };
      selected.forEach((domain) => {
        if (next[domain]) next[domain] = { ...next[domain], user_decision: 'review' };
      });
      return next;
    });
  }

  function handleApprove(domain) {
    setResults((prev) => ({ ...prev, [domain]: { ...prev[domain], user_decision: 'approved' } }));
  }

  function handleReject(domain) {
    setResults((prev) => ({ ...prev, [domain]: { ...prev[domain], user_decision: 'rejected' } }));
  }

  function handleMarkReview(domain) {
    setResults((prev) => ({ ...prev, [domain]: { ...prev[domain], user_decision: 'review' } }));
  }

  function handleOverrideGroup(domain, groupName, groupId) {
    setResults((prev) => ({
      ...prev,
      [domain]: { ...prev[domain], user_override_group_name: groupName || null, user_override_group_id: groupId || null, user_decision: 'approved' },
    }));
  }

  function handleClear() {
    setResults({});
    setSelected(new Set());
    localStorage.removeItem(STORAGE_KEY);
  }

  const exportList = selected.size ? resultList.filter((r) => selected.has(r.domain)) : filteredSorted;

  return (
    <div>
      <p className="helper-text">
        Research a dealership's current corporate ownership using Claude with real web search, then check it
        against existing HubSpot Dealership Groups. Nothing is ever written to HubSpot - every result is a
        recommendation for human review.
      </p>

      <div className="card card-fullwidth compact-controls">
        <div className="form-section">
          <div className="control-row">
            <div className="mode-tabs">
              {[
                ['single', 'Single company'],
                ['paste', 'Paste list'],
                ['file', 'Upload CSV/Excel'],
              ].map(([value, label]) => (
                <button key={value} onClick={() => setMode(value)} className={`mode-button${mode === value ? ' active' : ''}`}>
                  {label}
                </button>
              ))}
            </div>

            <div className="mode-tabs">
              <span className="detail-fact-label" style={{ alignSelf: 'center', marginRight: 4 }}>
                Research mode:
              </span>
              {[
                ['quick', 'Quick'],
                ['standard', 'Standard'],
                ['deep', 'Deep Research'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setResearchMode(value)}
                  className={`mode-button${researchMode === value ? ' active' : ''}`}
                  title={value === 'deep' ? 'Exhaustive investigation - slower, may occasionally exceed the serverless timeout.' : ''}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="form-section">
          {mode === 'single' && (
            <div className="compact-form-row">
              <input
                type="text"
                placeholder="Company Name (optional)"
                value={singleForm.company_name}
                onChange={(e) => setSingleForm((f) => ({ ...f, company_name: e.target.value }))}
                className="input"
              />
              <input
                type="text"
                placeholder="Company Domain (e.g. coconutpointford.com)"
                value={singleForm.domain}
                onChange={(e) => setSingleForm((f) => ({ ...f, domain: e.target.value }))}
                className="input"
              />
              <input
                type="text"
                placeholder="City (optional)"
                value={singleForm.city}
                onChange={(e) => setSingleForm((f) => ({ ...f, city: e.target.value }))}
                className="input"
              />
              <input
                type="text"
                placeholder="State (optional)"
                value={singleForm.state}
                onChange={(e) => setSingleForm((f) => ({ ...f, state: e.target.value }))}
                className="input"
              />
              <button onClick={handleRunSingle} disabled={running} className="btn btn-primary">
                {running ? `Researching… (${progress.done}/${progress.total})` : 'Research Company'}
              </button>
              {running && (
                <button onClick={handleStop} className="btn btn-secondary">
                  Stop
                </button>
              )}
            </div>
          )}

          {mode === 'paste' && (
            <>
              <textarea
                placeholder={'coconutpointford.com\nOR paste CSV/TSV rows with headers: Company Name, Company Domain, City, State'}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                className="input"
              />
              <div className="action-row">
                <button onClick={handleRunBatch} disabled={running} className="btn btn-primary">
                  {running ? `Researching… (${progress.done}/${progress.total})` : 'Research List'}
                </button>
                {running && (
                  <button onClick={handleStop} className="btn btn-secondary">
                    Stop
                  </button>
                )}
              </div>
            </>
          )}

          {mode === 'file' && (
            <>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} className="file-input" />
              <div className="action-row">
                <button onClick={handleRunBatch} disabled={running || !file} className="btn btn-primary">
                  {running ? `Researching… (${progress.done}/${progress.total})` : 'Research File'}
                </button>
                {running && (
                  <button onClick={handleStop} className="btn btn-secondary">
                    Stop
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {stats.total > 0 && (
        <div className="stats-bar">
          <div className="stat-chip">
            Total <strong>{stats.total}</strong>
          </div>
          <div className="stat-chip">
            Completed <strong>{stats.completed}</strong>
          </div>
          <div className="stat-chip stat-success">
            Mapped <strong>{stats.mapped}</strong>
          </div>
          <div className="stat-chip stat-info">
            Create New Group <strong>{stats.createNewGroup}</strong>
          </div>
          <div className="stat-chip stat-warning">
            Review <strong>{stats.review}</strong>
          </div>
          <div className="stat-chip">
            No Group Found <strong>{stats.noGroupFound}</strong>
          </div>
          <div className="stat-chip">
            Invalid <strong>{stats.invalid}</strong>
          </div>
          <div className="stat-chip stat-danger">
            Failed <strong>{stats.failed}</strong>
          </div>
        </div>
      )}

      {resultList.length > 0 && (
        <div className="filter-bar">
          <input
            type="text"
            placeholder="Search company, domain, group, owner, HubSpot ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input filter-search"
          />
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="input filter-select">
            {FILTERS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} className="input filter-select">
            {SORT_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                Sort: {label}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary" onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}>
            {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
          </button>
        </div>
      )}

      {resultList.length > 0 && (
        <div className="action-row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={toggleSelectAllVisible}>
            {selected.size ? `${selected.size} selected` : 'Select visible'}
          </button>
          <button className="btn btn-secondary" disabled={!selected.size || running} onClick={() => handleResearchSelected(researchMode)}>
            Research Selected
          </button>
          <button className="btn btn-secondary" disabled={!selected.size || running} onClick={() => handleResearchSelected('deep')}>
            Deep Research Selected
          </button>
          <button className="btn btn-secondary" disabled={!stats.failed || running} onClick={handleRetryFailed}>
            Retry Failed
          </button>
          <button className="btn btn-secondary" disabled={!selected.size} onClick={handleMarkReviewSelected}>
            Mark Review
          </button>
          <button className="btn btn-secondary" disabled={!exportList.length} onClick={() => downloadResultsCsv(exportList)}>
            Export {selected.size ? 'Selected' : 'Results'} (CSV)
          </button>
          <button className="btn btn-secondary" disabled={!exportList.length} onClick={() => downloadResultsExcel(exportList)}>
            Export {selected.size ? 'Selected' : 'Results'} (Excel)
          </button>
          <button className="btn btn-secondary" disabled={!resultList.length || running} onClick={handleClear}>
            Clear results
          </button>
        </div>
      )}

      <ResultsTable
        results={filteredSorted}
        selected={selected}
        onToggleSelect={toggleSelect}
        onRerun={(domain, m) => runBatch([recordFor(domain)], { skipCompleted: false, runMode: m || researchMode })}
        onApprove={handleApprove}
        onReject={handleReject}
        onMarkReview={handleMarkReview}
        onOverrideGroup={handleOverrideGroup}
      />
    </div>
  );
}
