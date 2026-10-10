/**
 * API service for communicating with the FastAPI backend.
 */

export interface MapEntry {
  id: string;
  label: string;
  file: string;
  runways: number;
  polygons: number;
  lines: number;
  defaultRunway?: string;
}

export interface ManifestResponse {
  version: number;
  defaultMap: string;
  maps: MapEntry[];
}

export interface FlightTelemetryPoint {
  time: number;
  x: number;
  y: number;
  z: number;
  pitch: number;
  roll: number;
  heading: number;
  airspeed_knots: number;
  altitude_feet: number;
  vertical_speed_fpm: number;
  throttle: number;
  gear: boolean;
  flaps: boolean;
}

export interface FlightRecord {
  id: string;
  map_id: string;
  map_label: string;
  runway_id: string;
  runway_heading: number;
  duration_seconds: number;
  max_speed_knots: number;
  max_altitude_feet: number;
  landing_status: 'landed' | 'crashed' | 'in_flight' | 'aborted';
  touchdown_vertical_speed_fpm?: number | null;
  centerline_offset_feet?: number | null;
  rating_stars: number;
  created_at: string;
  telemetry?: FlightTelemetryPoint[];
}

export interface JobRecord {
  id: string;
  filename: string;
  file_size: number;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'discarded';
  progress: number;
  created_at: string;
  completed_at?: string | null;
  error_message?: string | null;
  temp_dir?: string | null;
  zip_path?: string | null;
  logs: string[];
}

const API_BASE = '/api';

export async function getHealth(): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error('Backend health check failed');
  return res.json();
}

export async function getMaps(): Promise<ManifestResponse> {
  const res = await fetch(`${API_BASE}/maps`);
  if (!res.ok) {
    // Fallback to static manifest if backend is initializing
    const staticRes = await fetch('/maps/manifest.json');
    if (staticRes.ok) return staticRes.json();
    throw new Error('Failed to load map catalog');
  }
  return res.json();
}

export async function getMap(mapId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/maps/${mapId}`);
  if (!res.ok) {
    const staticRes = await fetch(`/maps/${mapId}.json`);
    if (staticRes.ok) return staticRes.json();
    throw new Error(`Failed to load map data for ${mapId}`);
  }
  return res.json();
}

export async function saveFlight(data: Omit<FlightRecord, 'id' | 'created_at'>): Promise<FlightRecord> {
  const res = await fetch(`${API_BASE}/flights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to save flight record');
  return res.json();
}

export async function getFlights(): Promise<FlightRecord[]> {
  const res = await fetch(`${API_BASE}/flights`);
  if (!res.ok) throw new Error('Failed to fetch flight history');
  return res.json();
}

export async function getFlight(flightId: string): Promise<FlightRecord> {
  const res = await fetch(`${API_BASE}/flights/${flightId}`);
  if (!res.ok) throw new Error(`Failed to fetch flight ${flightId}`);
  return res.json();
}

export async function deleteFlight(flightId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/flights/${flightId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to delete flight ${flightId}`);
}

export function downloadFlightZipUrl(flightId: string): string {
  return `${API_BASE}/flights/${flightId}/export-zip`;
}

export async function startConversion(file: File, conversionType = 'auto'): Promise<JobRecord> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('conversion_type', conversionType);

  const res = await fetch(`${API_BASE}/convert`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Conversion failed to start' }));
    throw new Error(err.detail || 'Failed to start conversion');
  }
  return res.json();
}

export async function getJobs(): Promise<JobRecord[]> {
  const res = await fetch(`${API_BASE}/jobs`);
  if (!res.ok) throw new Error('Failed to fetch jobs');
  return res.json();
}

export async function getJob(jobId: string): Promise<JobRecord> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}`);
  if (!res.ok) throw new Error(`Failed to fetch job ${jobId}`);
  return res.json();
}

export async function discardJob(jobId: string): Promise<{ job_id: string; status: string }> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/discard`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Failed to discard job ${jobId}`);
  return res.json();
}

export function downloadZipUrl(jobId: string): string {
  return `${API_BASE}/jobs/${jobId}/download-zip`;
}

