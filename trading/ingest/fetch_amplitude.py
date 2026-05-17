#!/usr/bin/env python3
"""
Ingest Amplitude exports (CSV) into normalized Parquet.

Expected CSV columns (flexible aliases):
  date / as_of_date / week_end
  map_key / project / app_id
  metric_name / metric / event
  value / count / uniques
  segment (optional)

Env:
  AMPLITUDE_EXPORT_DIR — folder to scan for *.csv
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import pandas as pd

from trading.lib.config import load_ticker_map
from trading.lib.paths import amplitude_dir

DATE_COLS = ("date", "as_of_date", "week_end", "period_end")
KEY_COLS = ("map_key", "project", "project_id", "app_id", "app")
METRIC_COLS = ("metric_name", "metric", "event", "event_type")
VALUE_COLS = ("value", "count", "uniques", "total")


def _first_col(df: pd.DataFrame, candidates: tuple[str, ...]) -> str | None:
    lower = {c.lower(): c for c in df.columns}
    for cand in candidates:
        if cand in lower:
            return lower[cand]
    return None


def normalize_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    if df.empty:
        return df

    date_c = _first_col(df, DATE_COLS)
    key_c = _first_col(df, KEY_COLS)
    metric_c = _first_col(df, METRIC_COLS)
    value_c = _first_col(df, VALUE_COLS)
    seg_c = _first_col(df, ("segment", "platform", "country"))

    if not all([date_c, key_c, metric_c, value_c]):
        raise ValueError(f"{path}: missing required columns (have {list(df.columns)})")

    out = pd.DataFrame(
        {
            "as_of_date": pd.to_datetime(df[date_c]).dt.date,
            "map_key": df[key_c].astype(str),
            "metric_name": df[metric_c].astype(str).str.lower(),
            "value": pd.to_numeric(df[value_c], errors="coerce"),
            "segment": df[seg_c].astype(str) if seg_c else "all",
        }
    )
    return out.dropna(subset=["value"])


def ingest_directory(export_dir: Path, output_dir: Path | None = None) -> pd.DataFrame:
    output_dir = output_dir or amplitude_dir()
    frames: list[pd.DataFrame] = []

    for csv_path in sorted(export_dir.glob("**/*.csv")):
        try:
            part = normalize_csv(csv_path)
            frames.append(part)
            print(f"OK {csv_path.name}: {len(part)} rows")
        except Exception as e:
            print(f"SKIP {csv_path.name}: {e}")

    if not frames:
        return pd.DataFrame()

    combined = pd.concat(frames, ignore_index=True)
    combined = (
        combined.groupby(["as_of_date", "map_key", "metric_name", "segment"], as_index=False)["value"]
        .mean()
    )

    for metric, grp in combined.groupby("metric_name"):
        out_path = output_dir / f"{metric}.parquet"
        if out_path.exists():
            existing = pd.read_parquet(out_path)
            grp = pd.concat([existing, grp], ignore_index=True).drop_duplicates(
                subset=["as_of_date", "map_key", "metric_name", "segment"],
                keep="last",
            )
        grp.to_parquet(out_path, index=False)
        print(f"Wrote {out_path}")

    return combined


def generate_sample_data(output_dir: Path | None = None) -> None:
    """Synthetic weekly metrics for ticker_map keys (offline dev / backtest)."""
    import numpy as np
    from datetime import date, timedelta

    from trading.lib.config import load_ticker_map

    output_dir = output_dir or amplitude_dir()
    tm = load_ticker_map()
    end = date.today()
    weeks = 104
    rng = np.random.default_rng(42)

    rows = []
    for w in range(weeks):
        as_of = end - timedelta(days=7 * w)
        for map_key in tm:
            base = 1_000_000 + hash(map_key) % 500_000
            noise = rng.normal(0, 0.03)
            rows.append(
                {
                    "as_of_date": as_of,
                    "map_key": map_key,
                    "metric_name": "wau",
                    "value": base * (1 + noise * (w / weeks)),
                    "segment": "all",
                }
            )
            rows.append(
                {
                    "as_of_date": as_of,
                    "map_key": map_key,
                    "metric_name": "retention_d7",
                    "value": 0.35 + rng.normal(0, 0.02),
                    "segment": "all",
                }
            )
            rows.append(
                {
                    "as_of_date": as_of,
                    "map_key": map_key,
                    "metric_name": "conversion_rate",
                    "value": 0.05 + rng.normal(0, 0.005),
                    "segment": "all",
                }
            )

    df = pd.DataFrame(rows)
    for metric, grp in df.groupby("metric_name"):
        (output_dir / f"{metric}.parquet").parent.mkdir(parents=True, exist_ok=True)
        grp.to_parquet(output_dir / f"{metric}.parquet", index=False)
    print(f"Generated sample Amplitude data for {len(tm)} map keys -> {output_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest Amplitude CSV exports")
    parser.add_argument("--dir", type=Path, default=None, help="Export directory")
    parser.add_argument("--sample", action="store_true", help="Generate synthetic data")
    args = parser.parse_args()

    if args.sample:
        generate_sample_data()
        return

    export_dir = args.dir or Path(os.environ.get("AMPLITUDE_EXPORT_DIR", ""))
    if not export_dir or not export_dir.is_dir():
        print("No export dir. Use --sample or set AMPLITUDE_EXPORT_DIR / --dir")
        load_ticker_map()
        generate_sample_data()
        return

    ingest_directory(export_dir)


if __name__ == "__main__":
    main()
