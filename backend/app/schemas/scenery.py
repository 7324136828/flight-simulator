"""Pydantic models for scenery and maps."""

from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field


class MapEntry(BaseModel):
    id: str
    label: str
    file: str
    runways: int
    polygons: int
    lines: int
    sourceFiles: list[str] = Field(default_factory=list)
    defaultRunway: str | None = None


class ManifestResponse(BaseModel):
    version: int
    defaultMap: str
    maps: list[MapEntry]


class RunwayInfo(BaseModel):
    id: str
    heading: float
    length: float
    width: float
    elevation: float
    east: float
    north: float
    latitude: float | None = None
    longitude: float | None = None


class MapDetail(BaseModel):
    version: int
    id: str | None = None
    label: str | None = None
    runways: list[dict[str, Any]] = Field(default_factory=list)
    polygons: int | None = None
    lines: int | None = None

