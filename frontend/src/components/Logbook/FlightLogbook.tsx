import React, { useState, useEffect } from 'react';
import {
  getFlights,
  getFlight,
  deleteFlight,
  downloadFlightZipUrl,
  FlightRecord,
} from '../../services/api';

interface FlightLogbookProps {
  onFlyClick?: () => void;
}

export const FlightLogbook: React.FC<FlightLogbookProps> = ({ onFlyClick }) => {
  const [flights, setFlights] = useState<FlightRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFlight, setSelectedFlight] = useState<FlightRecord | null>(null);

  const loadFlights = async () => {
    try {
      setLoading(true);
      const data = await getFlights();
      setFlights(data);
    } catch (e) {
      console.error('Failed to load flights', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFlights();
  }, []);

  const handleDelete = async (flightId: string) => {
    if (!window.confirm('Are you sure you want to delete this flight log entry?')) return;
    try {
      await deleteFlight(flightId);
      if (selectedFlight?.id === flightId) setSelectedFlight(null);
      loadFlights();
    } catch (e: any) {
      alert(`Could not delete flight: ${e.message}`);
    }
  };

  const handleViewTelemetry = async (flightId: string) => {
    try {
      const detail = await getFlight(flightId);
      setSelectedFlight(detail);
    } catch (e: any) {
      alert(`Could not load telemetry: ${e.message}`);
    }
  };

  // Compute summary stats
  const totalFlights = flights.length;
  const safeLandings = flights.filter((f) => f.landing_status === 'landed').length;
  const maxAlt = flights.reduce((m, f) => Math.max(m, f.max_altitude_feet || 0), 0);
  const maxSpd = flights.reduce((m, f) => Math.max(m, f.max_speed_knots || 0), 0);

  return (
    <div className="logbook-screen">
      <div className="logbook-header">
        <div>
          <h2>Flight Pilot Logbook</h2>
          <p>Official persistent registry of simulated flights, landings, and telemetry</p>
        </div>
        <button className="btn-primary" onClick={onFlyClick}>
          ✈ New Flight Departure
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">TOTAL FLIGHTS</span>
          <span className="stat-value">{totalFlights}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">SAFE TOUCHDOWNS</span>
          <span className="stat-value">{safeLandings}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">RECORD ALTITUDE</span>
          <span className="stat-value">{maxAlt.toFixed(0)} <small>ft</small></span>
        </div>
        <div className="stat-card">
          <span className="stat-label">TOP AIRSPEED</span>
          <span className="stat-value">{maxSpd.toFixed(0)} <small>kts</small></span>
        </div>
      </div>

      {loading ? (
        <div className="loading-state">
          <div className="spinner" />
          <p>Reading flight ledger from SQLite...</p>
        </div>
      ) : flights.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🛩</div>
          <h3>No Flights Logged Yet</h3>
          <p>
            Take off from the runway or fly final approach on the Flight Deck, then save your flight
            telemetry to view your pilot scorecard and flight statistics here.
          </p>
          <button className="btn-primary" onClick={onFlyClick}>
            Take to the Skies
          </button>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="logbook-table">
            <thead>
              <tr>
                <th>Date / Time</th>
                <th>Airfield / Scenery</th>
                <th>Runway</th>
                <th>Duration</th>
                <th>Top Speed</th>
                <th>Max Alt</th>
                <th>Status</th>
                <th>Sink Rate</th>
                <th>Rating</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {flights.map((flight) => (
                <tr key={flight.id} className={`status-row-${flight.landing_status}`}>
                  <td>{new Date(flight.created_at).toLocaleString()}</td>
                  <td><strong>{flight.map_label}</strong></td>
                  <td>{flight.runway_id ? `${flight.runway_id} (${flight.runway_heading.toFixed(0)}°)` : 'Direct'}</td>
                  <td>{flight.duration_seconds.toFixed(0)}s</td>
                  <td>{flight.max_speed_knots.toFixed(0)} kts</td>
                  <td>{flight.max_altitude_feet.toFixed(0)} ft</td>
                  <td>
                    <span className={`status-badge badge-${flight.landing_status}`}>
                      {flight.landing_status.toUpperCase()}
                    </span>
                  </td>
                  <td>
                    {flight.touchdown_vertical_speed_fpm != null
                      ? `${flight.touchdown_vertical_speed_fpm.toFixed(0)} fpm`
                      : '—'}
                  </td>
                  <td className="rating-cell">
                    {'★'.repeat(flight.rating_stars)}
                    {'☆'.repeat(5 - flight.rating_stars)}
                  </td>
                  <td>
                    <div className="action-buttons">
                      <button
                        className="btn-action btn-telemetry"
                        title="View Flight Telemetry"
                        onClick={() => handleViewTelemetry(flight.id)}
                      >
                        Telemetry
                      </button>
                      <a
                        className="btn-action btn-download"
                        href={downloadFlightZipUrl(flight.id)}
                        download
                        title="Download Flight ZIP (Report, KML, CSV)"
                      >
                        Export ZIP
                      </a>
                      <button
                        className="btn-action btn-delete"
                        title="Delete Flight Record"
                        onClick={() => handleDelete(flight.id)}
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Telemetry Details Modal */}
      {selectedFlight && (
        <div className="modal-backdrop" onClick={() => setSelectedFlight(null)}>
          <div className="modal-card telemetry-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Flight Telemetry: {selectedFlight.map_label}</h3>
              <button className="btn-close" onClick={() => setSelectedFlight(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="telemetry-summary">
                <div><strong>Duration:</strong> {selectedFlight.duration_seconds.toFixed(1)}s</div>
                <div><strong>Peak Altitude:</strong> {selectedFlight.max_altitude_feet.toFixed(0)} ft</div>
                <div><strong>Peak Speed:</strong> {selectedFlight.max_speed_knots.toFixed(0)} kts</div>
                <div><strong>Status:</strong> {selectedFlight.landing_status}</div>
                <div><strong>Recorded Points:</strong> {selectedFlight.telemetry?.length || 0}</div>
              </div>

              <h4>Recorded Telemetry Stream</h4>
              <div className="telemetry-table-container">
                <table className="telemetry-subtable">
                  <thead>
                    <tr>
                      <th>Time (s)</th>
                      <th>Speed (kts)</th>
                      <th>Alt (ft)</th>
                      <th>VSpeed (fpm)</th>
                      <th>Pitch (°)</th>
                      <th>Roll (°)</th>
                      <th>Heading (°)</th>
                      <th>Throttle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedFlight.telemetry || []).slice(0, 100).map((pt, i) => (
                      <tr key={i}>
                        <td>{pt.time}</td>
                        <td>{pt.airspeed_knots}</td>
                        <td>{pt.altitude_feet}</td>
                        <td>{pt.vertical_speed_fpm}</td>
                        <td>{pt.pitch}</td>
                        <td>{pt.roll}</td>
                        <td>{pt.heading}</td>
                        <td>{(pt.throttle * 100).toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="modal-footer">
              <a
                className="btn-primary"
                href={downloadFlightZipUrl(selectedFlight.id)}
                download
              >
                Download Complete Flight Package (.ZIP)
              </a>
              <button className="btn-secondary" onClick={() => setSelectedFlight(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
