import React, { useState, useEffect, useRef } from 'react';

interface FileUploadProps {
  onStartJob: (file: File, conversionType: string) => Promise<void>;
  disabled?: boolean;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onStartJob, disabled = false }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [conversionType, setConversionType] = useState('auto');
  const [isDragOver, setIsDragOver] = useState(false);
  const [pasteNotice, setPasteNotice] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = (file: File) => {
    setSelectedFile(file);
    // Auto-detect conversion type based on extension
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') setConversionType('pdf_document');
    else if (ext === 'json') setConversionType('flight_telemetry');
    else if (ext === 'bgl') setConversionType('bgl_scenery');
    else setConversionType('auto');
  };

  // Clipboard Paste (Ctrl+V) listener per Pillar 2 of SKILL.md
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const pastedFile = item.getAsFile();
          if (pastedFile) {
            handleFile(pastedFile);
            setPasteNotice(true);
            setTimeout(() => setPasteNotice(false), 3000);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;
    await onStartJob(selectedFile, conversionType);
    setSelectedFile(null);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="file-upload-card">
      <div className="card-header">
        <h3>Document & Flight Data Ingestion Hub</h3>
        <p>Stage PDF documents, flight telemetry recordings, or scenery binaries for isolated execution</p>
      </div>

      {pasteNotice && (
        <div className="paste-alert" role="status">
          ✓ File loaded from clipboard paste (Ctrl+V)!
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div
          className={`dropzone ${isDragOver ? 'is-dragover' : ''} ${selectedFile ? 'has-file' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.json,.bgl,.fso,.csv,.txt"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFile(e.target.files[0]);
              }
            }}
          />

          {!selectedFile ? (
            <div className="dropzone-prompt">
              <div className="dropzone-icon">📁</div>
              <h4>Choose a file, drag & drop here, or paste with Ctrl+V</h4>
              <p className="supported-formats">
                Supports: <strong>PDF documents</strong>, <strong>Telemetry JSON / CSV</strong>, <strong>BGL Scenery</strong>, and data logs
              </p>
              <div className="clipboard-hint">
                <span className="kbd-badge">Ctrl</span> + <span className="kbd-badge">V</span> Clipboard Paste Enabled
              </div>
            </div>
          ) : (
            <div className="staged-file-card" onClick={(e) => e.stopPropagation()}>
              <div className="file-icon">📄</div>
              <div className="file-meta">
                <strong className="file-name">{selectedFile.name}</strong>
                <span className="file-size">{formatFileSize(selectedFile.size)}</span>
              </div>
              <button
                type="button"
                className="btn-remove-file"
                onClick={() => setSelectedFile(null)}
              >
                ✕ Clear
              </button>
            </div>
          )}
        </div>

        {selectedFile && (
          <div className="pipeline-controls">
            <div className="field-group">
              <label htmlFor="conversion-type">Processing Pipeline Pipeline Type:</label>
              <select
                id="conversion-type"
                value={conversionType}
                onChange={(e) => setConversionType(e.target.value)}
              >
                <option value="auto">Auto-detect Pipeline</option>
                <option value="pdf_document">PDF Document Text & Metadata Extraction</option>
                <option value="flight_telemetry">Flight Telemetry & Performance Analysis</option>
                <option value="bgl_scenery">BGL Scenery & Airfield Verification</option>
                <option value="raw_text">Generic Text Processing & Archive Packaging</option>
              </select>
            </div>

            <button type="submit" className="btn-primary btn-start-job" disabled={disabled}>
              ⚡ Dispatch to Isolated Temp Pipeline
            </button>
          </div>
        )}
      </form>
    </div>
  );
};

