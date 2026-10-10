"""Pydantic models for flight logbook and telemetry."""

from __future__ import annotations

from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class FlightPoint(BaseModel):
    time: float
    x: float
    y: float
    z: float
    pitch: float
    roll: float
    heading: float
    airspeed_knots: float
    altitude_feet: float
    vertical_speed_fpm: float
    throttle: float
    gear: bool
    flaps: bool


class FlightCreate(BaseModel):
    map_id: str
    map_label: str
    runway_id: str
    runway_heading: float = 0.0
    duration_seconds: float
    max_speed_knots: float
    max_altitude_feet: float
    landing_status: str  # "landed", "crashed", "aborted"
    touchdown_vertical_speed_fpm: float | None = None
    centerline_offset_feet: float | None = None
    rating_stars: int = 0
    telemetry: list[dict[str, Any]] = Field(default_factory=list)


class FlightSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    map_id: str
    map_label: str
    runway_id: str
    runway_heading: float
    duration_seconds: float
    max_speed_knots: float
    max_altitude_feet: float
    landing_status: str
    touchdown_vertical_speed_fpm: float | None = None
    centerline_offset_feet: float | None = None
    rating_stars: int
    created_at: str


class FlightResponse(FlightSummary):
    telemetry: list[dict[str, Any]] = Field(default_factory=list)

