"""Scenery and map catalog service."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..config import MAPS_DIR


class SceneryService:
    """Provides access to original converted scenery maps and airport runways."""

    def __init__(self, maps_dir: Path | None = None) -> None:
        self.maps_dir = maps_dir or MAPS_DIR

    def get_manifest(self) -> dict[str, Any]:
        manifest_path = self.maps_dir / "manifest.json"
        if not manifest_path.is_file():
            raise FileNotFoundError(f"Manifest not found at {manifest_path}")
        with open(manifest_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def get_map(self, map_id: str) -> dict[str, Any]:
        manifest = self.get_manifest()
        matching = next((m for m in manifest.get("maps", []) if m.get("id") == map_id), None)
        if not matching:
            # Check by filename directly
            file_path = self.maps_dir / f"{map_id}.json"
            if file_path.is_file():
                with open(file_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            raise KeyError(f"Map '{map_id}' not found in manifest or file system")

        map_file = self.maps_dir / matching["file"]
        if not map_file.is_file():
            raise FileNotFoundError(f"Map file {map_file} not found")

        with open(map_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            data["id"] = matching["id"]
            data["label"] = matching["label"]
            return data

    def list_runways(self, map_id: str | None = None) -> list[dict[str, Any]]:
        manifest = self.get_manifest()
        runways = []
        map_ids = [map_id] if map_id else [m["id"] for m in manifest.get("maps", [])]

        for m_id in map_ids:
            try:
                map_data = self.get_map(m_id)
                for r in map_data.get("runways", []):
                    runways.append({
                        "map_id": m_id,
                        "map_label": map_data.get("label", m_id),
                        "runway_id": r.get("id"),
                        "heading": r.get("heading"),
                        "length": r.get("length"),
                        "width": r.get("width"),
                        "elevation": r.get("elevation"),
                        "east": r.get("east"),
                        "north": r.get("north"),
                    })
            except Exception:
                continue
        return runways

