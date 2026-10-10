import React, { useState, useEffect, useCallback } from 'react';
import { FileUpload } from './FileUpload';
import { JobStatus } from './JobStatus';
import { ConversionHistory } from './ConversionHistory';
import {
  getJobs,
  startConversion,
  discardJob,
  JobRecord,
} from '../../services/api';

export const DataHub: React.FC = () => {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeJob, setActiveJob] = useState<JobRecord | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const data = await getJobs();
      setJobs(data);

      // If there's an active job being monitored, keep its state updated
      if (activeJob) {
        const updated = data.find((j) => j.id === activeJob.id);
        if (updated) setActiveJob(updated);
      }
    } catch (e) {
      console.error('Failed to poll jobs', e);
    } finally {
      setLoading(false);
    }
  }, [activeJob]);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 3500);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const handleStartJob = async (file: File, conversionType: string) => {
    try {
      const created = await startConversion(file, conversionType);
      setActiveJob(created);
      fetchJobs();
    } catch (e: any) {
      alert(`Failed to start job: ${e.message}`);
    }
  };

  const handleDiscard = async (jobId: string) => {
    try {
      await discardJob(jobId);
      if (activeJob?.id === jobId) {
        setActiveJob(null);
      }
      fetchJobs();
    } catch (e: any) {
      alert(`Failed to discard job: ${e.message}`);
    }
  };

  const handleContinueJob = (job: JobRecord) => {
    setActiveJob(job);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="datahub-screen">
      <div className="datahub-hero">
        <h2>Data Hub & Background Conversion Pipeline</h2>
        <p>
          Production execution layer utilizing isolated system temporary folders (<code>tempfile.gettempdir()</code>),
          multi-stage extraction, and automatic ZIP packaging.
        </p>
      </div>

      {activeJob && (
        <JobStatus
          job={activeJob}
          onDiscard={handleDiscard}
          onClose={() => setActiveJob(null)}
        />
      )}

      <FileUpload onStartJob={handleStartJob} />

      <ConversionHistory
        jobs={jobs}
        loading={loading}
        onContinueJob={handleContinueJob}
        onDiscardJob={handleDiscard}
      />
    </div>
  );
};

