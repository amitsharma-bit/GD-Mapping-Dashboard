import React, { useState } from 'react';
import DealershipMappingTab from './components/DealershipMappingTab.jsx';
import TechIntelTab from './components/TechIntelTab.jsx';

const TABS = [
  { key: 'mapping', label: 'Dealership Group Mapping', Component: DealershipMappingTab },
  { key: 'tech', label: 'Technology Intelligence Agent', Component: TechIntelTab },
];

export default function App() {
  const [activeTab, setActiveTab] = useState(TABS[0].key);
  const ActiveComponent = TABS.find((t) => t.key === activeTab).Component;

  return (
    <div className="app-shell">
      <h1 className="dashboard-title">Dealership Intelligence Dashboard</h1>

      <div className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`tab-button${activeTab === tab.key ? ' active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div key={activeTab} className="tab-panel">
        <ActiveComponent />
      </div>
    </div>
  );
}
