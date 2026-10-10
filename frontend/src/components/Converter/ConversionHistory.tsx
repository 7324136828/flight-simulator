import React from 'react';
import { JobRecord, downloadZipUrl } from '../../services/api';

interface ConversionHistoryProps {
  jobs: JobRecord[];
  loading: boolean;
  onContinueJob: (job: JobRecord) => void;
  onDiscardJob: (jobId: string) => Promise<void>;
}

export const ConversionHistory: React.FC<ConversionHistoryProps> = ({
  jobs,
  loading,
  onContinueJob,
  onDiscardJob,
}) => {
  const formatSize = (bytes: number) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatElapsed = (created: string, completed?: string | null) => {
    const start = new Date(created).getTime();
    const end = completed ? new Date(completed).getTime() : Date.now();
    const sec = Math.max(0, Math.round((end - start) / 1000));
    return `${sec}s`;
  };

  return (
    <div className="history-screen">
      <div className="history-header">
        <h3>Conversion & Ingestion History</h3>
        <span className="auto-refresh-pill">● Polling Active (4s)</span>
      </div>

      {loading && jobs.length === 0 ? (
        <div className="loading-state">
          <div className="spinner" />
          <p>Loading conversion ledger...</p>
        </div>
      ) : jobs.length === 0 ? (
        <div className="empty-state">
          <p>No historical jobs found. Upload or paste a file above to start a background conversion.</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>Document / Filename</th>
                <th>Size</th>
                <th>Created At</th>
                <th>Elapsed</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className={`status-row-${job.status}`}>
                  <td>
                    <strong className="table-filename">{job.filename}</strong>
                    <div className="table-job-id"><code>{job.id.slice(0, 8)}...</code></div>
                  </td>
                  <td>{formatSize(job.file_size)}</td>
                  <td>{new Date(job.created_at).toLocaleTimeString()}</td>
                  <td>{formatElapsed(job.created_at, job.completed_at)}</td>
                  <td>
                    <span className={`badge badge-${job.status}`}>
                      {job.status === 'in_progress' && <span className="pulse-dot" />}
                      {job.status}
                    </span>
                  </td>
                  <td>
                    <div className="mini-progress-bar">
                      <div
                        className="mini-progress-fill"
                        style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
                      />
                    </div>
                  </td>
                  <td>
                    <div className="history-actions">
                      {job.status === 'in_progress' && (
                        <>
                          <button
                            className="btn-continue"
                            onClick={() => onContinueJob(job)}
                            title="Reconnect to live monitor"
                          >
                            Continue
                          </button>
                          <button
                            className="btn-discard"
                            onClick={() => onDiscardJob(job.id)}
                            title="Discard and purge temp"
                          >
                            Discard
                          </button>
                        </>
                      )}

                      {job.status === 'completed' && (
                        <a
                          className="btn-download"
                          href={downloadZipUrl(job.id)}
                          download
                          title="Download converted ZIP archive"
                        >
                          Download ZIP
                        </a>
                      )}

                      {(job.status === 'failed' || job.status === 'discarded') && (
                        <span className="text-muted">{job.status}</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

