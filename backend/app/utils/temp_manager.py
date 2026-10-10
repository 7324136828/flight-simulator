"""Isolated system temporary directory manager.

Manages job lifecycle directories under the operating system temporary folder:
  <tempfile.gettempdir()>/prod_jobs/<job_id>/
  ├── inputs/
  ├── work/
  ├── outputs/
  └── archive/
"""

from __future__ import annotations

import shutil
import zipfile
from pathlib import Path
from typing import BinaryIO

from ..config import get_temp_base_dir


class TempManager:
    """Manages isolated temp directory lifecycles for background jobs."""

    def __init__(self, base_dir: Path | None = None) -> None:
        self.base_dir = base_dir or get_temp_base_dir()
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def create_job_env(self, job_id: str) -> dict[str, Path]:
        """Creates the isolated job directory structure."""
        job_dir = self.base_dir / job_id
        inputs_dir = job_dir / "inputs"
        work_dir = job_dir / "work"
        outputs_dir = job_dir / "outputs"
        archive_dir = job_dir / "archive"

        inputs_dir.mkdir(parents=True, exist_ok=True)
        work_dir.mkdir(parents=True, exist_ok=True)
        outputs_dir.mkdir(parents=True, exist_ok=True)
        archive_dir.mkdir(parents=True, exist_ok=True)

        return {
            "root": job_dir,
            "inputs": inputs_dir,
            "work": work_dir,
            "outputs": outputs_dir,
            "archive": archive_dir,
        }

    def get_job_dir(self, job_id: str) -> Path:
        """Returns the job directory path."""
        return self.base_dir / job_id

    def stage_file(self, job_id: str, filename: str, content: bytes | BinaryIO) -> Path:
        """Stages an uploaded or pasted file in inputs/."""
        env = self.create_job_env(job_id)
        # Sanitize filename
        safe_name = Path(filename).name or "staged_file.bin"
        target_path = env["inputs"] / safe_name

        if isinstance(content, bytes):
            target_path.write_bytes(content)
        else:
            with open(target_path, "wb") as f:
                shutil.copyfileobj(content, f)

        return target_path

    def package_outputs_to_zip(
        self, job_id: str, archive_name: str = "conversion_output.zip"
    ) -> Path:
        """Packages all files from outputs/ into archive/<archive_name>."""
        job_dir = self.get_job_dir(job_id)
        outputs_dir = job_dir / "outputs"
        archive_dir = job_dir / "archive"
        archive_dir.mkdir(parents=True, exist_ok=True)

        zip_path = archive_dir / archive_name
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for file_path in outputs_dir.rglob("*"):
                if file_path.is_file():
                    zf.write(file_path, arcname=file_path.relative_to(outputs_dir))

        return zip_path

    def purge_job_env(self, job_id: str) -> bool:
        """Purges the isolated job folder from system temp."""
        job_dir = self.get_job_dir(job_id)
        if job_dir.is_dir():
            shutil.rmtree(job_dir, ignore_errors=True)
            return True
        return False

