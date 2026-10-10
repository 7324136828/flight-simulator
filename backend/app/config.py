"""Application configuration settings."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent

BACKEND_HOST = os.environ.get("BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = int(os.environ.get("BACKEND_PORT", "8000"))


def resolve_maps_dir() -> Path:
    """Finds scenery maps directory across self-contained production paths."""
    candidates = [
        BACKEND_DIR / "app" / "maps",
        PROJECT_ROOT / "data" / "maps",
        PROJECT_ROOT / "frontend" / "public" / "maps",
        PROJECT_ROOT / "original-project" / "maps",
    ]
    for candidate in candidates:
        if candidate.is_dir() and (candidate / "manifest.json").is_file():
            return candidate
    return BACKEND_DIR / "app" / "maps"


MAPS_DIR = resolve_maps_dir()


def get_database_path() -> Path:
    configured = os.environ.get("DATABASE_PATH") or os.environ.get("COUNTER_DB_PATH") or "data/flight_simulator.db"
    db_path = Path(configured).expanduser()
    if not db_path.is_absolute():
        db_path = PROJECT_ROOT / db_path
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return db_path


def get_cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173")
    if raw.strip() == "*":
        return ["*"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def get_temp_base_dir() -> Path:
    base = Path(tempfile.gettempdir()) / "prod_jobs"
    base.mkdir(parents=True, exist_ok=True)
    return base
