"""Keep test application settings and data out of the user's real folders."""

from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch


@contextmanager
def isolated_storage(root: Path):
    with patch.dict(
        os.environ,
        {
            "APPDATA": str(root / "roaming"),
            "XDG_CONFIG_HOME": str(root / "config"),
            "TEMP": str(root / "temp"),
            "DATABASE_PATH": "",
            "COUNTER_DB_PATH": "",
        },
    ):
        yield
