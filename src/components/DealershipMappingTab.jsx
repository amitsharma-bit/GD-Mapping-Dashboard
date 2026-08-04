import React, { useEffect, useState } from 'react';
import ResultsTable from './ResultsTable.jsx';
import { parseDomainsFromFile, parseDomainsFromText } from '../lib/parseFile.js';
import { processDomain } from '../lib/api.js';
import { downloadResultsCsv } from '../lib/exportCsv.js';

const STORAGE_KEY = 'gd-mapping-results';

function loadStoredResults() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export default function DealershipMappingTab() {
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

    for (const domain of pending) {
      try {
        const result = await processDomain(domain);
        setResults((prev) => ({ ...prev, [domain]: result }));
      } catch (err) {
        setResults((prev) => ({
          ...prev,
          [domain]: { domain, recommendation: 'REVIEW', confidence: 0, reason: `Request failed: ${err.message}`, error: true },
        }));
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

  return (
    <div>
      <p className="helper-text">
        Research a domain's ultimate dealership ownership and check it against existing HubSpot Dealership Groups.
        Results are recommendations only — nothing is written to HubSpot.
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
          <input
            type="text"
            placeholder="fordabc.com"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="input"
          />
        )}

        {mode === 'paste' && (
          <textarea
            placeholder={'fordabc.com\nchevydealer.com\n...'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            className="input"
          />
        )}

        {mode === 'file' && (
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="file-input"
          />
        )}

        <div className="action-row">
          <button onClick={handleRun} disabled={running} className="btn btn-primary">
            {running ? `Processing… (${progress.done}/${progress.total})` : 'Run'}
          </button>
          <button onClick={() => downloadResultsCsv(resultList)} disabled={!resultList.length} className="btn btn-secondary">
            Export CSV
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
        </div>
      </div>

      <ResultsTable results={resultList} />
    </div>
  );
}
