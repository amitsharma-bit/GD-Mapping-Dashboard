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
    <div style={{ maxWidth: 960, margin: '32px auto', fontFamily: 'system-ui, sans-serif', padding: '0 16px' }}>
      <h1>Dealership Intelligence Dashboard</h1>

      <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #e5e7eb', marginBottom: 20 }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 15,
              fontWeight: activeTab === tab.key ? 'bold' : 'normal',
              borderBottom: activeTab === tab.key ? '2px solid #2563eb' : '2px solid transparent',
              marginBottom: -2,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <ActiveComponent />
    </div>
  );
}
