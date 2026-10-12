"""Smoke-test generated Windows packages without touching distribution files."""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
from contextlib import contextmanager
from pathlib import Path

import httpx

from backend.network import discover_lan_ipv4
from backend.settings import APP_NAME

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def free_ports() -> tuple[int, int]:
    with socket.socket() as frontend, socket.socket() as backend:
        frontend.bind(("127.0.0.1", 0))
        backend.bind(("127.0.0.1", 0))
        return frontend.getsockname()[1], backend.getsockname()[1]


@unittest.skipUnless(os.name == "nt", "Generated run.bat packages require Windows")
class FrozenPackageTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="frozen-package-")
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        self.package = self.root / "renamed portable package"
        self.package.mkdir()
        self.temp = self.root / "temp"
        self.temp.mkdir()
        self.settings_path = self.root / "appdata" / APP_NAME / "settings.json"

    def prepare_package(self, profile: str) -> tuple[int, int]:
        source = PROJECT_ROOT / "dist" / profile
        if not (source / "server.exe").is_file():
            self.skipTest(f"Build dist/{profile}/server.exe to test the frozen package")
        for name in ("server.exe", "run.bat", "runtime.json"):
            shutil.copy2(source / name, self.package / name)
        shutil.copytree(source / "public", self.package / "public")
        ports = free_ports()
        (self.package / "port_mapping.json").write_text(
            json.dumps({"frontend_port": ports[0], "backend_port": ports[1]}),
            encoding="utf-8",
        )
        return ports

    def environment(self) -> dict[str, str]:
        environment = os.environ.copy()
        for name in (
            "FRONTEND_PORT", "BACKEND_PORT", "BACKEND_HOST", "DATABASE_PATH",
            "COUNTER_DB_PATH", "CORS_ORIGINS", "PYTHONPATH", "PYTHONHOME",
            "_PYI_APPLICATION_HOME_DIR", "_PYI_ARCHIVE_FILE", "_PYI_PARENT_PROCESS_LEVEL",
        ):
            environment.pop(name, None)
        environment.update({
            "APPDATA": str(self.root / "appdata"),
            "XDG_CONFIG_HOME": str(self.root / "appdata"),
            "TEMP": str(self.temp),
            "TMP": str(self.temp),
            "TMPDIR": str(self.temp),
        })
        return environment

    @contextmanager
    def running(self, frontend: int, backend: int):
        with (self.root / "startup.log").open("w+b") as log:
            process = subprocess.Popen(
                [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/c", "call run.bat"],
                cwd=self.package,
                env=self.environment(),
                stdout=log,
                stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            try:
                with httpx.Client(trust_env=False, timeout=2) as client:
                    deadline = time.monotonic() + 45
                    ready = False
                    while time.monotonic() < deadline:
                        if process.poll() is not None:
                            break
                        try:
                            ready = all(
                                client.get(f"http://127.0.0.1:{port}/api/health").status_code == 200
                                for port in (frontend, backend)
                            )
                            if ready:
                                break
                        except httpx.RequestError:
                            pass
                        time.sleep(0.1)
                    if not ready:
                        log.seek(0)
                        self.fail("Frozen run.bat did not become ready:\n" + log.read().decode("utf-8", errors="replace"))
                    yield client
            finally:
                if process.poll() is None:
                    # The launcher owns a PyInstaller parent and extracted child.
                    # Terminating cmd.exe alone would leave both servers running.
                    result = subprocess.run(
                        ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                        capture_output=True,
                        timeout=10,
                        creationflags=subprocess.CREATE_NO_WINDOW,
                    )
                    if result.returncode and process.poll() is None:
                        self.fail("Could not stop the frozen launcher process tree:\n" + result.stderr.decode(errors="replace"))
                process.wait(timeout=10)

    def assert_maps(self, client: httpx.Client, frontend: int, backend: int, *, static: bool) -> None:
        frontend_url = f"http://127.0.0.1:{frontend}"
        backend_url = f"http://127.0.0.1:{backend}"
        index = client.get(frontend_url)
        self.assertEqual(index.status_code, 200)
        self.assertIn("Flight Simulator", index.text)
        self.assertIn('src="/assets/', index.text)
        manifest = client.get(frontend_url + "/api/maps")
        self.assertEqual(manifest.status_code, 200)
        self.assertIn("chicago", {item["id"] for item in manifest.json()["maps"]})
        detail = client.get(backend_url + "/api/maps/chicago")
        self.assertEqual(detail.status_code, 200)
        self.assertGreater(len(detail.json()["runways"]), 0)
        if static:
            static_manifest = client.get(frontend_url + "/maps/manifest.json")
            self.assertEqual(static_manifest.status_code, 200)
            for field in ("version", "defaultMap", "maps"):
                self.assertEqual(static_manifest.json()[field], manifest.json()[field])
            self.assertEqual(client.get(frontend_url + "/maps/chicago.json").status_code, 200)

    def assert_release_lan(self, client: httpx.Client, frontend: int, backend: int) -> None:
        for address in discover_lan_ipv4():
            with self.subTest(lan_address=address):
                self.assertEqual(client.get(f"http://{address}:{frontend}").status_code, 200)
                self.assertEqual(client.get(f"http://{address}:{frontend}/api/health").json()["status"], "ok")
                self.assertEqual(client.get(f"http://{address}:{backend}/api/health").json()["status"], "ok")

    def exercise_profile(self, profile: str) -> None:
        frontend, backend = self.prepare_package(profile)
        self.assertFalse(self.settings_path.exists())
        default_storage = self.temp / APP_NAME

        with self.running(frontend, backend) as client:
            self.assert_maps(client, frontend, backend, static=True)
            self.assertEqual(
                json.loads(self.settings_path.read_text(encoding="utf-8")),
                {"frontend_port": frontend, "backend_port": backend, "data_directory": str(default_storage)},
            )
            self.assertTrue((default_storage / "flight_simulator.db").is_file())
            self.assertEqual(client.post(f"http://127.0.0.1:{frontend}/api/counter/click").json()["count"], 1)
            if profile == "Release":
                self.assert_release_lan(client, frontend, backend)

        # Removing external scenery proves the next API request uses maps
        # embedded in server.exe, independently of the frontend's asset folder.
        maps = (self.package / "public" / "maps").resolve()
        saved_maps = (self.package / "saved frontend maps").resolve()
        self.assertTrue(maps.is_relative_to(self.package.resolve()))
        self.assertTrue(saved_maps.is_relative_to(self.package.resolve()))
        maps.rename(saved_maps)

        frontend, backend = free_ports()
        storage = self.root / "chosen data storage"
        values = {
            "frontend_port": frontend,
            "backend_port": backend,
            "data_directory": str(storage),
            "custom_setting": {"theme": "dark", "enabled": True},
        }
        original = json.dumps(values, indent=3) + "\n"
        self.settings_path.write_text(original, encoding="utf-8")
        with self.running(frontend, backend) as client:
            self.assert_maps(client, frontend, backend, static=False)
            frontend_url = f"http://127.0.0.1:{frontend}"
            self.assertEqual(client.get(frontend_url + "/api/counter").json()["count"], 0)
            self.assertEqual(client.post(frontend_url + "/api/counter/click").json()["count"], 1)
            conversion = client.post(
                frontend_url + "/api/convert",
                files={"file": ("frozen flight.txt", b"frozen flight data", "text/plain")},
            )
            self.assertEqual(conversion.status_code, 202)
            job_id = conversion.json()["id"]
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                job = client.get(frontend_url + f"/api/jobs/{job_id}").json()
                if job["status"] in ("completed", "failed"):
                    break
                time.sleep(0.05)
            self.assertEqual(job["status"], "completed")
            self.assertTrue(Path(job["zip_path"]).is_relative_to(storage))
            self.assertEqual(client.get(frontend_url + f"/api/jobs/{job_id}/download-zip").status_code, 200)
            self.assertTrue((storage / "flight_simulator.db").is_file())
            self.assertEqual(self.settings_path.read_text(encoding="utf-8"), original)

        with self.running(frontend, backend) as client:
            frontend_url = f"http://127.0.0.1:{frontend}"
            self.assertEqual(client.get(frontend_url + "/api/counter").json()["count"], 1)
            self.assertEqual(client.get(frontend_url + f"/api/jobs/{job_id}/download-zip").status_code, 200)
            self.assertEqual(self.settings_path.read_text(encoding="utf-8"), original)

    def test_debug_run_bat_initializes_settings_and_serves_frozen_application(self) -> None:
        self.exercise_profile("Debug")

    def test_release_run_bat_initializes_settings_and_serves_frozen_application_over_lan(self) -> None:
        self.exercise_profile("Release")


if __name__ == "__main__":
    unittest.main()
