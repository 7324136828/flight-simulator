"""Pydantic models for jobs."""

from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

JobStatus = Literal["queued", "in_progress", "completed", "failed", "discarded"]


class JobCreate(BaseModel):
    filename: str
    conversion_type: str = "auto"
    options: dict = Field(default_factory=dict)


class JobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    file_size: int = 0
    status: JobStatus
    progress: int = 0
    created_at: str
    completed_at: str | None = None
    error_message: str | None = None
    temp_dir: str | None = None
    zip_path: str | None = None
    logs: list[str] = Field(default_factory=list)


class JobStatusUpdate(BaseModel):
    status: JobStatus
    progress: int | None = None
    error_message: str | None = None
    zip_path: str | None = None
    log_line: str | None = None


class JobDiscardResponse(BaseModel):
    job_id: str
    status: str = "discarded"
    detail: str = "Temporary folder purged and job discarded"

