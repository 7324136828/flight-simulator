import { useState, useEffect, useCallback } from 'react';
import { Navigation, ActiveTab } from './components/Navigation';
import { FlightSimulator } from './components/FlightSimulator/FlightSimulator';
import { FlightLogbook } from './components/Logbook/FlightLogbook';
import { DataHub } from './components/Converter/DataHub';
import { getHealth, getFlights, getJobs } from './services/api';
import './simulator/ui.css';
import './styles.css';

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('simulator');
  const [apiConnected, setApiConnected] = useState(false);
  const [flightCount, setFlightCount] = useState(0);
  const [activeJobsCount, setActiveJobsCount] = useState(0);

  const checkStatus = useCallback(async () => {
    try {
      await getHealth();
      setApiConnected(true);

      const flights = await getFlights();
      setFlightCount(flights.length);

      const jobs = await getJobs();
      const inProgress = jobs.filter((j) => j.status === 'in_progress' || j.status === 'queued').length;
      setActiveJobsCount(inProgress);
    } catch {
      setApiConnected(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  return (
    <div className="app-shell">
      <Navigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
        apiConnected={apiConnected}
        flightCount={flightCount}
        activeJobsCount={activeJobsCount}
      />

      <main className="app-main-content">
        {activeTab === 'simulator' && (
          <FlightSimulator onFlightSaved={checkStatus} />
        )}
        {activeTab === 'logbook' && (
          <FlightLogbook onFlyClick={() => setActiveTab('simulator')} />
        )}
        {activeTab === 'converter' && <DataHub />}
      </main>
    </div>
  );
}

export default App;
