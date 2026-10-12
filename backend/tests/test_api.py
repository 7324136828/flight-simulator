"""Comprehensive backend tests for the Flight Simulator API."""

import io
import tempfile
import time
import unittest
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from backend.tests.storage_support import isolated_storage

# The application currently initializes its services when imported.
with tempfile.TemporaryDirectory() as bootstrap_directory:
    with isolated_storage(Path(bootstrap_directory)):
        from backend.app.main import create_app


class FlightSimulatorApiTestCase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        storage = isolated_storage(Path(self.temp_dir.name))
        storage.__enter__()
        self.addCleanup(storage.__exit__, None, None, None)
        self.db_path = Path(self.temp_dir.name) / "test.db"
        self.app = create_app(db_path=self.db_path)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def test_health(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_maps_manifest(self):
        response = self.client.get("/api/maps")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("maps", data)
        self.assertIn("defaultMap", data)
        # Ensure Chicago is present
        map_ids = [m["id"] for m in data["maps"]]
        self.assertIn("chicago", map_ids)

    def test_map_detail(self):
        response = self.client.get("/api/maps/chicago")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["id"], "chicago")
        self.assertIn("runways", data)
        self.assertGreater(len(data["runways"]), 0)

    def test_flight_lifecycle_and_zip_export(self):
        # 1. Create flight record
        flight_payload = {
            "map_id": "chicago",
            "map_label": "Chicago · Meigs Field",
            "runway_id": "scenery-chicago-bgl-18197",
            "runway_heading": 360.0,
            "duration_seconds": 124.5,
            "max_speed_knots": 85.0,
            "max_altitude_feet": 1200.0,
            "landing_status": "landed",
            "touchdown_vertical_speed_fpm": -120.0,
            "centerline_offset_feet": 4.5,
            "rating_stars": 5,
            "telemetry": [
                {
                    "time": 0.0,
                    "x": 0.0,
                    "y": 10.0,
                    "z": -1000.0,
                    "pitch": 0.0,
                    "roll": 0.0,
                    "heading": 360.0,
                    "airspeed_knots": 65.0,
                    "altitude_feet": 200.0,
                    "vertical_speed_fpm": -500.0,
                    "throttle": 0.35,
                    "gear": True,
                    "flaps": True,
                },
                {
                    "time": 10.0,
                    "x": 1.0,
                    "y": 0.5,
                    "z": 100.0,
                    "pitch": 4.0,
                    "roll": 0.0,
                    "heading": 360.0,
                    "airspeed_knots": 50.0,
                    "altitude_feet": 5.0,
                    "vertical_speed_fpm": -120.0,
                    "throttle": 0.0,
                    "gear": True,
                    "flaps": True,
                },
            ],
        }
        create_res = self.client.post("/api/flights", json=flight_payload)
        self.assertEqual(create_res.status_code, 201)
        created_flight = create_res.json()
        flight_id = created_flight["id"]
        self.assertEqual(created_flight["landing_status"], "landed")

        # 2. List flights
        list_res = self.client.get("/api/flights")
        self.assertEqual(list_res.status_code, 200)
        flights = list_res.json()
        self.assertEqual(len(flights), 1)
        self.assertEqual(flights[0]["id"], flight_id)

        # 3. Get single flight with telemetry
        get_res = self.client.get(f"/api/flights/{flight_id}")
        self.assertEqual(get_res.status_code, 200)
        detail = get_res.json()
        self.assertEqual(len(detail["telemetry"]), 2)

        # 4. Export flight package ZIP
        zip_res = self.client.post(f"/api/flights/{flight_id}/export-zip")
        self.assertEqual(zip_res.status_code, 200)
        self.assertEqual(zip_res.headers["content-type"], "application/zip")

        # Verify ZIP contents
        with zipfile.ZipFile(io.BytesIO(zip_res.content)) as zf:
            file_names = zf.namelist()
            self.assertIn("flight_summary.md", file_names)
            self.assertIn("telemetry.json", file_names)
            self.assertIn("flight_track.csv", file_names)
            self.assertIn("flight_path.kml", file_names)

        # 5. Delete flight
        del_res = self.client.delete(f"/api/flights/{flight_id}")
        self.assertEqual(del_res.status_code, 200)
        self.assertTrue(del_res.json()["deleted"])

    def test_job_conversion_and_discard(self):
        # 1. Create a dummy file for conversion
        file_content = b"%PDF-1.4 simulated pdf document with (flight information) and data"
        files = {"file": ("test_doc.pdf", file_content, "application/pdf")}
        data = {"conversion_type": "pdf_report"}

        res = self.client.post("/api/convert", files=files, data=data)
        self.assertEqual(res.status_code, 202)
        job_id = res.json()["id"]
        job_directory = Path(res.json()["temp_dir"])
        self.assertTrue(job_directory.is_relative_to(Path(self.temp_dir.name)))

        # Wait briefly for background pipeline task
        time.sleep(1.0)

        # 2. Check job status
        job_res = self.client.get(f"/api/jobs/{job_id}")
        self.assertEqual(job_res.status_code, 200)
        job_data = job_res.json()
        self.assertIn(job_data["status"], ["in_progress", "completed"])

        # Wait for completion
        for _ in range(20):
            if job_data["status"] == "completed":
                break
            time.sleep(0.2)
            job_data = self.client.get(f"/api/jobs/{job_id}").json()

        self.assertEqual(job_data["status"], "completed")
        self.assertEqual(job_data["progress"], 100)

        # 3. Download ZIP
        zip_res = self.client.get(f"/api/jobs/{job_id}/download-zip")
        self.assertEqual(zip_res.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(zip_res.content)) as zf:
            names = zf.namelist()
            self.assertTrue(any("content.md" in n or "metadata.json" in n for n in names))

    def test_job_discard(self):
        file_content = b"sample scenery or log data"
        files = {"file": ("test_data.txt", file_content, "text/plain")}
        res = self.client.post("/api/convert", files=files)
        self.assertEqual(res.status_code, 202)
        job_id = res.json()["id"]

        # Discard job
        discard_res = self.client.post(f"/api/jobs/{job_id}/discard")
        self.assertEqual(discard_res.status_code, 200)
        self.assertEqual(discard_res.json()["status"], "discarded")
        self.assertFalse(self.app.state.temp_manager.get_job_dir(job_id).exists())

        # Verify job is marked discarded
        job = self.client.get(f"/api/jobs/{job_id}").json()
        self.assertEqual(job["status"], "discarded")


if __name__ == "__main__":
    unittest.main()
