import React, { useState } from 'react';
import { JobRecord, downloadZipUrl } from '../../services/api';

interface JobStatusProps {
  job: JobRecord;
  onDiscard: (jobId: string) => Promise<void>;
  onClose?: () => void;
}

export const JobStatus: React.FC<JobStatusProps> = ({ job, onDiscard, onClose }) => {
  const [logsExpanded, setLogsExpanded] = useState(true);
  const [discarding, setDiscarding] = useState(false);

  const handleDiscard = async () => {
    if (!window.confirm('Are you sure you want to discard this job and purge its temporary files?')) {
      return;
    }
    setDiscarding(true);
    try {
      await onDiscard(job.id);
    } finally {
      setDiscarding(false);
    }
  };

  const getStageClass = (threshold: number) => {
    if (job.status === 'completed') return 'stage-done';
    if (job.status === 'failed' || job.status === 'discarded') return 'stage-stopped';
    if (job.progress >= threshold) return 'stage-done';
    if (job.progress >= threshold - 25) return 'stage-active';
    return 'stage-pending';
  };

  return (
    <div className={`job-status-card status-${job.status}`}>
      <div className="job-status-header">
        <div className="status-title-group">
          <span className={`badge badge-${job.status}`}>
            {job.status === 'in_progress' && <span className="pulse-spinner" />}
            {job.status.toUpperCase()}
          </span>
          <h4>Job Monitor: {job.filename}</h4>
        </div>
        {onClose && (
          <button className="btn-close-monitor" onClick={onClose}>
            ✕ Close
          </button>
        )}
      </div>

      <div className="job-meta-row">
        <div><strong>Job ID:</strong> <code>{job.id}</code></div>
        <div><strong>Size:</strong> {(job.file_size / 1024).toFixed(1)} KB</div>
        <div><strong>Created:</strong> {new Date(job.created_at).toLocaleTimeString()}</div>
        {job.completed_at && (
          <div><strong>Completed:</strong> {new Date(job.completed_at).toLocaleTimeString()}</div>
        )}
      </div>

      {/* Multi-stage Progress Indicators */}
      <div className="stages-timeline">
        <div className={`timeline-stage ${getStageClass(20)}`}>
          <span className="stage-num">1</span>
          <span className="stage-name">Staging in Temp</span>
        </div>
        <div className={`timeline-stage ${getStageClass(50)}`}>
          <span className="stage-num">2</span>
          <span className="stage-name">Processing Data</span>
        </div>
        <div className={`timeline-stage ${getStageClass(80)}`}>
          <span className="stage-num">3</span>
          <span className="stage-name">Generating Reports</span>
        </div>
        <div className={`timeline-stage ${getStageClass(100)}`}>
          <span className="stage-num">4</span>
          <span className="stage-name">Packaging ZIP</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="progress-container">
        <div
          className="progress-bar-fill"
          style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
        />
        <span className="progress-text">{job.progress}%</span>
      </div>

      {job.error_message && (
        <div className="error-alert">
          <strong>Error encountered:</strong> {job.error_message}
        </div>
      )}

      {/* Collapsible Log Viewer */}
      <div className="log-viewer-wrapper">
        <button
          type="button"
          className="log-toggle-btn"
          onClick={() => setLogsExpanded(!logsExpanded)}
        >
          <span>{logsExpanded ? '▼ Hide Execution Logs' : '► Show Execution Logs'}</span>
          <span className="log-count">({job.logs?.length || 0} events)</span>
        </button>

        {logsExpanded && (
          <div className="log-console">
            {(job.logs && job.logs.length > 0) ? (
              job.logs.map((log, index) => (
                <div key={index} className="log-line">
                  <span className="log-prefix">&gt;</span> {log}
                </div>
              ))
            ) : (
              <div className="log-line empty">Awaiting pipeline logs...</div>
            )}
          </div>
        )}
      </div>

      {/* Action Controls */}
      <div className="job-action-footer">
        {job.status === 'in_progress' && (
          <button
            className="btn-discard"
            onClick={handleDiscard}
            disabled={discarding}
          >
            {discarding ? 'Discarding...' : '✖ Discard Job & Purge Temp'}
          </button>
        )}

        {job.status === 'completed' && (
          <a
            className="btn-download"
            href={downloadZipUrl(job.id)}
            download
          >
            ⬇ Download Consolidated ZIP
          </a>
        )}

        {job.status === 'discarded' && (
          <span className="discarded-notice">
            Temporary directory purged under operating system temp folder.
          </span>
        )}
      </div>
    </div>
  );
};

