"""Verify all mutable application data follows the configured storage folder."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend import settings
from backend.app import config
from backend.tests.storage_support import isolated_storage

with tempfile.TemporaryDirectory() as bootstrap_directory:
    with isolated_storage(Path(bootstrap_directory)):
        from backend.app.main import create_app


class StorageTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        environment = isolated_storage(self.root)
        environment.__enter__()
        self.addCleanup(environment.__exit__, None, None, None)

    def write_settings(self, directory: Path) -> Path:
        path = settings.settings_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "data_directory": str(directory),
                    "frontend_port": 4510,
                    "backend_port": 4520,
                    "theme": "dark",
                },
                indent=2,
            ) + "\n",
            encoding="utf-8",
        )
        return path

    def test_default_database_and_jobs_share_application_temp_storage(self) -> None:
        storage = self.root / "temp" / settings.APP_NAME
        application = create_app()

        self.assertEqual(application.state.db.db_path, storage / "flight_simulator.db")
        self.assertEqual(application.state.counter_store.database_path, application.state.db.db_path)
        self.assertEqual(application.state.temp_manager.base_dir, storage / "jobs")
        self.assertTrue(application.state.db.db_path.is_file())
        self.assertEqual(settings.load_settings().data_directory, storage)
        self.assertEqual(
            json.loads(settings.settings_path().read_text(encoding="utf-8"))["data_directory"],
            str(storage),
        )

    def test_custom_storage_persists_counter_flights_jobs_and_export_artifacts(self) -> None:
        storage = self.root / "chosen storage" / "records"
        path = self.write_settings(storage)
        original_settings = path.read_bytes()
        application = create_app()

        with TestClient(application) as client:
            self.assertEqual(client.post("/api/counter/click").json()["count"], 1)
            flight = client.post(
                "/api/flights",
                json={
                    "map_id": "chicago",
                    "map_label": "Chicago",
                    "runway_id": "scenery-chicago-bgl-18197",
                    "runway_heading": 360.0,
                    "duration_seconds": 124.5,
                    "max_speed_knots": 85.0,
                    "max_altitude_feet": 1200.0,
                    "landing_status": "landed",
                    "telemetry": [],
                },
            )
            self.assertEqual(flight.status_code, 201)
            flight_id = flight.json()["id"]

            exported = client.post(f"/api/flights/{flight_id}/export-zip")
            self.assertEqual(exported.status_code, 200)
            export_directory = storage / "jobs" / f"export_{flight_id}"
            self.assertTrue((export_directory / "outputs" / "telemetry.json").is_file())
            self.assertTrue(any((export_directory / "archive").glob("*.zip")))

            conversion = client.post(
                "/api/convert",
                files={"file": ("flight log.txt", b"flight data", "text/plain")},
            )
            self.assertEqual(conversion.status_code, 202)
            job_id = conversion.json()["id"]
            completed = client.get(f"/api/jobs/{job_id}").json()
            self.assertEqual(completed["status"], "completed")
            self.assertEqual(Path(completed["temp_dir"]), storage / "jobs" / job_id)
            archive = Path(completed["zip_path"])
            self.assertTrue(archive.is_relative_to(storage))
            self.assertTrue(archive.is_file())
            self.assertEqual(client.get(f"/api/jobs/{job_id}/download-zip").status_code, 200)

        with TestClient(create_app()) as restarted:
            self.assertEqual(restarted.get("/api/counter").json()["count"], 1)
            self.assertEqual(restarted.get(f"/api/flights/{flight_id}").status_code, 200)
            self.assertEqual(restarted.get(f"/api/jobs/{job_id}").json()["status"], "completed")
            self.assertEqual(restarted.get(f"/api/jobs/{job_id}/download-zip").status_code, 200)

        self.assertTrue((storage / "flight_simulator.db").is_file())
        self.assertFalse((self.root / "temp" / settings.APP_NAME / "flight_simulator.db").exists())
        self.assertEqual(path.read_bytes(), original_settings)

    def test_database_environment_overrides_keep_jobs_in_configured_storage(self) -> None:
        storage = self.root / "storage"
        self.write_settings(storage)
        with patch.dict(os.environ, {"COUNTER_DB_PATH": str(self.root / "counter.db")}):
            self.assertEqual(config.get_database_path(), self.root / "counter.db")
            self.assertEqual(config.get_temp_base_dir(), storage / "jobs")
            with patch.dict(os.environ, {"DATABASE_PATH": "  "}):
                self.assertEqual(config.get_database_path(), self.root / "counter.db")
            with patch.dict(os.environ, {"DATABASE_PATH": "overrides/flight.db"}):
                with patch.object(config, "PROJECT_ROOT", self.root):
                    self.assertEqual(config.get_database_path(), self.root / "overrides" / "flight.db")
            with patch.dict(os.environ, {"DATABASE_PATH": "  ", "COUNTER_DB_PATH": "\t"}):
                self.assertEqual(config.get_database_path(), storage / "flight_simulator.db")


if __name__ == "__main__":
    unittest.main()
