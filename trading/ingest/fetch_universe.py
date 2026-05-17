#!/usr/bin/env python3
"""Build NASDAQ-100 membership table (daily, point-in-time simplified)."""

from __future__ import annotations

import argparse
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import yaml

from trading.lib.paths import config_dir, universe_dir


def load_symbol_list() -> list[str]:
    path = config_dir() / "nasdaq100_symbols.yaml"
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    symbols = data.get("symbols") or []
    return sorted({s.upper() for s in symbols})


def build_membership(
    start: date,
    end: date,
    symbols: list[str] | None = None,
) -> pd.DataFrame:
    """
    v1: static membership for all dates in range.
    Replace with historical index reconstitution feed for production PIT accuracy.
    """
    symbols = symbols or load_symbol_list()
    rows = []
    current = start
    while current <= end:
        for sym in symbols:
            rows.append({"date": current, "symbol": sym, "in_index": True})
        current += timedelta(days=1)
    return pd.DataFrame(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch NASDAQ-100 universe membership")
    parser.add_argument("--years", type=int, default=5, help="Years of history")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    end = date.today()
    start = end - timedelta(days=365 * args.years)
    df = build_membership(start, end)

    out = args.output or (universe_dir() / "nasdaq100_membership.parquet")
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False)
    print(f"Wrote {len(df)} rows -> {out} ({df['symbol'].nunique()} symbols)")


if __name__ == "__main__":
    main()
