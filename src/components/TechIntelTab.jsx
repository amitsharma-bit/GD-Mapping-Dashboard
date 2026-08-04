import React, { useEffect, useState } from 'react';
import TechResultsTable from './TechResultsTable.jsx';
import { parseDomainsFromFile, parseDomainsFromText } from '../lib/parseFile.js';
import { scanTechStack } from '../lib/api.js';

const STORAGE_KEY = 'gd-tech-intel-results';

function loadStoredResults() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export default function TechIntelTab() {
  const [mode, setMode] = useState('single');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [results, setResults] = useState(loadStoredResults);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
  }, [results]);

  async function runBatch(domains) {
    const unique = [...new Set(domains.map((d) => d.trim()).filter(Boolean))];
    const pending = unique.filter((d) => !results[d]);
    setRunning(true);
    setProgress({ done: 0, total: unique.length });
    let done = unique.length - pending.length;

    // One domain at a time - this account's Firecrawl plan is rate-limited to 5 req/min,
    // and each scan's crawl-status polling already uses several requests on its own.
    for (const domain of pending) {
      try {
        const result = await scanTechStack(domain);
        setResults((prev) => ({ ...prev, [domain]: result }));
      } catch (err) {
        setResults((prev) => ({ ...prev, [domain]: { domain, error: true, reason: `Request failed: ${err.message}` } }));
      }
      done += 1;
      setProgress({ done, total: unique.length });
    }
    setRunning(false);
  }

  async function handleRun() {
    let domains = [];
    if (mode === 'file' && file) domains = await parseDomainsFromFile(file);
    else domains = parseDomainsFromText(text);
    if (domains.length) runBatch(domains);
  }

  const resultList = Object.values(results).sort((a, b) => a.domain.localeCompare(b.domain));

  const actionButtons = (
    <>
      <button onClick={handleRun} disabled={running} className="btn btn-primary">
        {running ? `Scanning… (${progress.done}/${progress.total})` : 'Scan'}
      </button>
      <button
        onClick={() => {
          setResults({});
          localStorage.removeItem(STORAGE_KEY);
        }}
        disabled={!resultList.length || running}
        className="btn btn-secondary"
      >
        Clear results
      </button>
    </>
  );

  return (
    <div>
      <p className="helper-text">
        Crawls a dealership website and identifies its technology stack (chat, CRM, website provider, analytics,
        service scheduler, and more) from verifiable evidence only — no guessing. Click a company name for full
        details.
      </p>

      <div className="card">
        <div className="mode-tabs">
          {[
            ['single', 'Single domain'],
            ['paste', 'Paste list'],
            ['file', 'Upload CSV/Excel'],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className={`mode-button${mode === value ? ' active' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'single' && (
          <div className="search-row">
            <input
              type="text"
              placeholder="abcford.com"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRun()}
              className="input"
            />
            {actionButtons}
          </div>
        )}

        {mode === 'paste' && (
          <>
            <textarea
              placeholder={'abcford.com\nchevydealer.com\n...'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              className="input"
            />
            <div className="action-row">{actionButtons}</div>
          </>
        )}

        {mode === 'file' && (
          <>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="file-input"
            />
            <div className="action-row">{actionButtons}</div>
          </>
        )}
      </div>

      <TechResultsTable results={resultList} />
    </div>
  );
}
