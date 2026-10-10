import React from 'react';

export type ActiveTab = 'simulator' | 'logbook' | 'converter';

interface NavigationProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  apiConnected: boolean;
  flightCount: number;
  activeJobsCount: number;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onTabChange,
  apiConnected,
  flightCount,
  activeJobsCount,
}) => {
  return (
    <header className="app-navbar">
      <div className="nav-left">
        <div className="nav-brand">
          <svg className="brand-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3.5c-.5-.5-2.5 0-4 1.5L13.5 8.5 5.3 6.7c-.8-.2-1.6.1-2.1.7l-.7.7 5.8 3.5L5 15l-2.5-.5L1 16l3.5 1.5L6 21l1.5-1.5-.5-2.5 3.4-3.3 3.5 5.8c.6.5 1.4.8 2.2.7l.7-.7c.6-.5.9-1.3.7-2.1z" />
          </svg>
          <div className="brand-text">
            <span className="brand-title">FLIGHT SIMULATOR</span>
            <span className="brand-subtitle">WEB EDITION · FULL-STACK</span>
          </div>
        </div>
      </div>

      <nav className="nav-tabs" role="tablist" aria-label="Main Navigation">
        <button
          className={`nav-tab ${activeTab === 'simulator' ? 'is-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'simulator'}
          onClick={() => onTabChange('simulator')}
        >
          <span className="tab-icon">✈</span>
          <span className="tab-label">Flight Deck</span>
        </button>

        <button
          className={`nav-tab ${activeTab === 'logbook' ? 'is-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'logbook'}
          onClick={() => onTabChange('logbook')}
        >
          <span className="tab-icon">📋</span>
          <span className="tab-label">Flight Logbook</span>
          {flightCount > 0 && <span className="nav-pill">{flightCount}</span>}
        </button>

        <button
          className={`nav-tab ${activeTab === 'converter' ? 'is-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'converter'}
          onClick={() => onTabChange('converter')}
        >
          <span className="tab-icon">🔄</span>
          <span className="tab-label">Data Hub & Converter</span>
          {activeJobsCount > 0 && (
            <span className="nav-pill nav-pill-active">{activeJobsCount}</span>
          )}
        </button>
      </nav>

      <div className="nav-right">
        <div className={`api-status-badge ${apiConnected ? 'is-online' : 'is-offline'}`}>
          <span className="status-dot" />
          <span>{apiConnected ? 'API Connected' : 'API Connecting...'}</span>
        </div>
      </div>
    </header>
  );
};

