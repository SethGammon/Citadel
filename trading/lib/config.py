from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from trading.lib.paths import config_dir


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_spec() -> dict[str, Any]:
    return _load_yaml(config_dir() / "spec.yaml")


def load_ticker_map() -> dict[str, dict[str, str]]:
    raw = _load_yaml(config_dir() / "ticker_map.yaml")
    return {k: v for k, v in raw.items() if isinstance(v, dict) and "symbol" in v}


def map_key_to_symbol(map_key: str, ticker_map: dict[str, dict[str, str]] | None = None) -> str | None:
    tm = ticker_map if ticker_map is not None else load_ticker_map()
    entry = tm.get(map_key)
    return entry["symbol"].upper() if entry else None
