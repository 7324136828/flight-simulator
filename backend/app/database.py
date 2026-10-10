"""SQLite persistence layer for jobs and flights."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


from contextlib import contextmanager


class Database:
    """Manages SQLite tables and queries for production jobs and flight records."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path

    @contextmanager
    def _connect(self):
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path), timeout=30.0)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def initialize(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    filename TEXT NOT NULL,
                    file_size INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    completed_at TEXT,
                    error_message TEXT,
                    temp_dir TEXT,
                    zip_path TEXT,
                    logs TEXT NOT NULL DEFAULT '[]'
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS flights (
                    id TEXT PRIMARY KEY,
                    map_id TEXT NOT NULL,
                    map_label TEXT NOT NULL,
                    runway_id TEXT NOT NULL,
                    runway_heading REAL NOT NULL,
                    duration_seconds REAL NOT NULL,
                    max_speed_knots REAL NOT NULL,
                    max_altitude_feet REAL NOT NULL,
                    landing_status TEXT NOT NULL,
                    touchdown_vertical_speed_fpm REAL,
                    centerline_offset_feet REAL,
                    rating_stars INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    telemetry_json TEXT NOT NULL DEFAULT '[]'
                )
                """
            )
            conn.commit()

    # --- Job operations ---

    def create_job(
        self,
        job_id: str,
        filename: str,
        file_size: int,
        temp_dir: str,
        status: str = "queued",
    ) -> dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        logs_json = json.dumps([f"Job created at {now}"])
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO jobs (id, filename, file_size, status, progress, created_at, temp_dir, logs)
                VALUES (?, ?, ?, ?, 0, ?, ?, ?)
                """,
                (job_id, filename, file_size, status, now, temp_dir, logs_json),
            )
            conn.commit()
        return self.get_job(job_id) or {}

    def update_job(
        self,
        job_id: str,
        status: str | None = None,
        progress: int | None = None,
        completed_at: str | None = None,
        error_message: str | None = None,
        zip_path: str | None = None,
        append_log: str | None = None,
    ) -> dict[str, Any] | None:
        job = self.get_job(job_id)
        if not job:
            return None

        updates = []
        params = []
        if status is not None:
            updates.append("status = ?")
            params.append(status)
        if progress is not None:
            updates.append("progress = ?")
            params.append(progress)
        if completed_at is not None:
            updates.append("completed_at = ?")
            params.append(completed_at)
        if error_message is not None:
            updates.append("error_message = ?")
            params.append(error_message)
        if zip_path is not None:
            updates.append("zip_path = ?")
            params.append(zip_path)
        if append_log is not None:
            logs = job.get("logs", [])
            logs.append(append_log)
            updates.append("logs = ?")
            params.append(json.dumps(logs))

        if updates:
            params.append(job_id)
            query = f"UPDATE jobs SET {', '.join(updates)} WHERE id = ?"
            with self._connect() as conn:
                conn.execute(query, params)
                conn.commit()

        return self.get_job(job_id)

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            cursor = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
            row = cursor.fetchone()
            if not row:
                return None
            data = dict(row)
            data["logs"] = json.loads(data.get("logs") or "[]")
            return data

    def list_jobs(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            cursor = conn.execute("SELECT * FROM jobs ORDER BY created_at DESC")
            rows = cursor.fetchall()
            result = []
            for row in rows:
                data = dict(row)
                data["logs"] = json.loads(data.get("logs") or "[]")
                result.append(data)
            return result

    def delete_job(self, job_id: str) -> bool:
        with self._connect() as conn:
            cursor = conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
            conn.commit()
            return cursor.rowcount > 0

    # --- Flight operations ---

    def create_flight(self, flight_id: str, data: dict[str, Any]) -> dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        telemetry_json = json.dumps(data.get("telemetry", []))
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO flights (
                    id, map_id, map_label, runway_id, runway_heading,
                    duration_seconds, max_speed_knots, max_altitude_feet,
                    landing_status, touchdown_vertical_speed_fpm, centerline_offset_feet,
                    rating_stars, created_at, telemetry_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    flight_id,
                    data.get("map_id", "chicago"),
                    data.get("map_label", "Chicago · Meigs Field"),
                    data.get("runway_id", ""),
                    float(data.get("runway_heading", 0.0)),
                    float(data.get("duration_seconds", 0.0)),
                    float(data.get("max_speed_knots", 0.0)),
                    float(data.get("max_altitude_feet", 0.0)),
                    data.get("landing_status", "completed"),
                    data.get("touchdown_vertical_speed_fpm"),
                    data.get("centerline_offset_feet"),
                    int(data.get("rating_stars", 0)),
                    now,
                    telemetry_json,
                ),
            )
            conn.commit()
        return self.get_flight(flight_id) or {}

    def get_flight(self, flight_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            cursor = conn.execute("SELECT * FROM flights WHERE id = ?", (flight_id,))
            row = cursor.fetchone()
            if not row:
                return None
            data = dict(row)
            data["telemetry"] = json.loads(data.get("telemetry_json") or "[]")
            del data["telemetry_json"]
            return data

    def list_flights(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            cursor = conn.execute(
                """
                SELECT id, map_id, map_label, runway_id, runway_heading,
                       duration_seconds, max_speed_knots, max_altitude_feet,
                       landing_status, touchdown_vertical_speed_fpm, centerline_offset_feet,
                       rating_stars, created_at
                FROM flights
                ORDER BY created_at DESC
                """
            )
            return [dict(row) for row in cursor.fetchall()]

    def delete_flight(self, flight_id: str) -> bool:
        with self._connect() as conn:
            cursor = conn.execute("DELETE FROM flights WHERE id = ?", (flight_id,))
            conn.commit()
            return cursor.rowcount > 0
