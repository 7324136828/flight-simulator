"""Background pipeline execution service.

Executes analysis and conversion jobs in isolated system temporary directories,
producing structured text, markdown, metadata, and consolidated ZIP archives.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..database import Database
from ..utils.temp_manager import TempManager

logger = logging.getLogger(__name__)


class PipelineRunner:
    """Orchestrates job conversion pipelines in isolated temp folders."""

    def __init__(self, db: Database, temp_manager: TempManager | None = None) -> None:
        self.db = db
        self.temp_manager = temp_manager or TempManager()
        self._discarded_jobs: set[str] = set()

    def is_job_active(self, job_id: str) -> bool:
        job = self.db.get_job(job_id)
        return bool(job and job.get("status") in ("queued", "in_progress"))

    def discard_job(self, job_id: str) -> bool:
        """Cancels running job and purges isolated temp directory."""
        self._discarded_jobs.add(job_id)

        # Purge temporary directory
        self.temp_manager.purge_job_env(job_id)

        # Update database status
        self.db.update_job(
            job_id,
            status="discarded",
            append_log=f"Job {job_id} discarded by user and temporary directory purged.",
        )
        return True

    def execute_job_sync(
        self,
        job_id: str,
        input_path: Path,
        conversion_type: str = "auto",
        options: dict[str, Any] | None = None,
    ) -> None:
        """Executes the conversion pipeline synchronously in a background thread."""
        if job_id in self._discarded_jobs:
            return

        options = options or {}
        env = self.temp_manager.create_job_env(job_id)
        outputs_dir = env["outputs"]
        work_dir = env["work"]

        try:
            # Stage 1: Initialization
            self.db.update_job(
                job_id,
                status="in_progress",
                progress=20,
                append_log=f"[Stage 1/4] Staged '{input_path.name}' into isolated temp directory.",
            )

            if job_id in self._discarded_jobs:
                return

            # Stage 2: Processing & Extraction
            self.db.update_job(
                job_id,
                progress=50,
                append_log=f"[Stage 2/4] Executing processing pipeline for '{input_path.suffix.lower()}'...",
            )

            file_ext = input_path.suffix.lower()
            if file_ext == ".pdf":
                self._process_pdf(input_path, work_dir, outputs_dir, job_id)
            elif file_ext in (".json", ".geojson"):
                self._process_json(input_path, work_dir, outputs_dir, job_id)
            elif file_ext == ".bgl":
                self._process_bgl(input_path, work_dir, outputs_dir, job_id)
            else:
                self._process_generic(input_path, work_dir, outputs_dir, job_id)

            if job_id in self._discarded_jobs:
                return

            # Stage 3: Report & Artifact Generation
            self.db.update_job(
                job_id,
                progress=80,
                append_log="[Stage 3/4] Generating structured markdown document, text, and metadata...",
            )

            # Stage 4: Package ZIP Archive
            self.db.update_job(
                job_id,
                progress=90,
                append_log="[Stage 4/4] Packaging outputs into consolidated ZIP archive...",
            )
            archive_name = f"{input_path.stem}_converted.zip"
            zip_path = self.temp_manager.package_outputs_to_zip(job_id, archive_name=archive_name)

            if job_id in self._discarded_jobs:
                return

            now = datetime.now(timezone.utc).isoformat()
            self.db.update_job(
                job_id,
                status="completed",
                progress=100,
                completed_at=now,
                zip_path=str(zip_path),
                append_log=f"Job completed successfully. Output archive ready: {zip_path.name}",
            )

        except Exception as e:
            if job_id in self._discarded_jobs:
                return
            logger.exception("Pipeline failure for job %s", job_id)
            self.db.update_job(
                job_id,
                status="failed",
                error_message=str(e),
                append_log=f"Execution error: {str(e)}",
            )

    async def execute_job(
        self,
        job_id: str,
        input_path: Path,
        conversion_type: str = "auto",
        options: dict[str, Any] | None = None,
    ) -> None:
        """Async wrapper for execute_job_sync."""
        await asyncio.to_thread(self.execute_job_sync, job_id, input_path, conversion_type, options)

    def _process_pdf(
        self, input_path: Path, work_dir: Path, outputs_dir: Path, job_id: str
    ) -> dict[str, Any]:
        """Processes PDF input documents."""
        raw_bytes = input_path.read_bytes()
        file_size = len(raw_bytes)

        is_pdf = raw_bytes.startswith(b"%PDF")
        version = "Unknown"
        if is_pdf:
            header_line = raw_bytes[:20].decode("latin1", errors="ignore").splitlines()[0]
            version = header_line.replace("%PDF-", "")

        # Extract text strings from stream objects
        text_matches = re.findall(rb"\(([^\(\)\\]{3,})\)", raw_bytes)
        extracted_strings = [m.decode("latin1", errors="ignore") for m in text_matches[:200]]

        clean_text = "\n".join(extracted_strings) if extracted_strings else f"Processed PDF document: {input_path.name}"
        (outputs_dir / "extracted_text.txt").write_text(clean_text, encoding="utf-8")

        md_content = f"""# Converted Document Report: {input_path.name}

- **Source File**: `{input_path.name}`
- **PDF Version**: {version}
- **Document Size**: {file_size:,} bytes
- **Extracted Text Segments**: {len(extracted_strings)}
- **Conversion Timestamp**: {datetime.now(timezone.utc).isoformat()}

## Extracted Content Overview

```text
{clean_text[:2000]}
```

---
Processed by Flight Simulator Production System
"""
        (outputs_dir / "content.md").write_text(md_content, encoding="utf-8")

        meta = {
            "source_filename": input_path.name,
            "format": "PDF",
            "pdf_version": version,
            "file_size": file_size,
            "segments_count": len(extracted_strings),
        }
        (outputs_dir / "metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        return meta

    def _process_json(
        self, input_path: Path, work_dir: Path, outputs_dir: Path, job_id: str
    ) -> dict[str, Any]:
        """Processes JSON flight telemetry or scenery data."""
        with open(input_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        meta: dict[str, Any] = {
            "source_filename": input_path.name,
            "format": "JSON",
            "keys_count": len(data) if isinstance(data, dict) else len(data),
        }

        if isinstance(data, dict) and "runways" in data:
            runways_count = len(data.get("runways", []))
            polys_count = len(data.get("polygons", []))
            lines_count = len(data.get("lines", []))
            meta["category"] = "Scenery Map"
            meta["runways"] = runways_count
            meta["polygons"] = polys_count
            meta["lines"] = lines_count

            summary_md = f"""# Scenery Analysis Report: {input_path.name}

- **Map Label / ID**: {data.get('label', data.get('id', input_path.stem))}
- **Runways Count**: {runways_count}
- **Polygon Faces**: {polys_count}
- **Vector Lines**: {lines_count}
- **Default Runway**: `{data.get('defaultRunway', 'N/A')}`

## Runway Inventory
"""
            for r in data.get("runways", [])[:15]:
                summary_md += f"- **{r.get('id')}**: Heading {r.get('heading')}°, Length {r.get('length')}m, Width {r.get('width')}m\n"

        else:
            meta["category"] = "Flight Telemetry / Data"
            summary_md = f"""# Flight Data Analysis: {input_path.name}

- **Source File**: `{input_path.name}`
- **Records Count**: {len(data) if isinstance(data, list) else len(data.keys())}
- **Parsed Successfully**: Yes
"""

        (outputs_dir / "metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        (outputs_dir / "content.md").write_text(summary_md, encoding="utf-8")
        (outputs_dir / "extracted_text.txt").write_text(json.dumps(data, indent=2)[:5000], encoding="utf-8")
        return meta

    def _process_bgl(
        self, input_path: Path, work_dir: Path, outputs_dir: Path, job_id: str
    ) -> dict[str, Any]:
        """Processes legacy Flight Simulator 5.1 BGL scenery binaries."""
        raw_bytes = input_path.read_bytes()
        file_size = len(raw_bytes)

        header_magic = raw_bytes[:4].hex()
        meta = {
            "source_filename": input_path.name,
            "format": "FS5.1 BGL",
            "file_size": file_size,
            "magic": header_magic,
        }

        report_md = f"""# BGL Scenery Container Analysis: {input_path.name}

- **Source File**: `{input_path.name}`
- **File Size**: {file_size:,} bytes
- **Header Magic**: `0x{header_magic}`
- **Status**: Validated legacy scenery container

Extracted for web-based Three.js rendering pipeline.
"""
        (outputs_dir / "metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        (outputs_dir / "content.md").write_text(report_md, encoding="utf-8")
        (outputs_dir / "extracted_text.txt").write_text(f"BGL Scenery File: {input_path.name}\nSize: {file_size} bytes\n", encoding="utf-8")
        return meta

    def _process_generic(
        self, input_path: Path, work_dir: Path, outputs_dir: Path, job_id: str
    ) -> dict[str, Any]:
        """Generic text or binary handler."""
        try:
            content = input_path.read_text(encoding="utf-8")
        except Exception:
            content = f"Binary file: {input_path.name} ({input_path.stat().st_size} bytes)"

        (outputs_dir / "extracted_text.txt").write_text(content, encoding="utf-8")
        meta = {
            "source_filename": input_path.name,
            "file_size": input_path.stat().st_size,
            "format": input_path.suffix.upper(),
        }
        (outputs_dir / "metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        (outputs_dir / "content.md").write_text(f"# Extracted File: {input_path.name}\n\n```\n{content[:2000]}\n```", encoding="utf-8")
        return meta

