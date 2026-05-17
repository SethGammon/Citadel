#!/usr/bin/env python3
"""Rank universe and emit long-only entry/exit signals."""

from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path

import pandas as pd

from trading.lib.config import load_spec
from trading.lib.paths import features_dir, signals_dir


def rank_day(feat: pd.DataFrame, as_of: date, spec: dict) -> pd.DataFrame:
    day = feat[feat["date"] == as_of].copy()
    if day.empty:
        return day

    top_pct = float(spec.get("top_quintile_pct", 0.2))
    min_adv = float(spec.get("min_adv_usd", 5_000_000))

    day = day.sort_values("score", ascending=False)
    n_top = max(1, int(len(day) * top_pct))
    day["rank"] = range(1, len(day) + 1)
    day["in_top_quintile"] = day["rank"] <= n_top

    day["enter"] = (
        day["in_top_quintile"]
        & (day["rs_20d"] > 0)
        & day["above_sma20"]
        & (day["adv_20d"] >= min_adv)
    )
    day["exit"] = (~day["in_top_quintile"]) | (~day["above_sma20"])
    return day


def rank_all(feat: pd.DataFrame, spec: dict | None = None) -> pd.DataFrame:
    spec = spec or load_spec()
    dates = sorted(feat["date"].unique())
    frames = [rank_day(feat, d, spec) for d in dates]
    return pd.concat(frames, ignore_index=True)


def latest_entries(ranked: pd.DataFrame) -> pd.DataFrame:
    if ranked.empty:
        return ranked
    last_date = ranked["date"].max()
    return ranked[(ranked["date"] == last_date) & ranked["enter"]].sort_values("score", ascending=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate rank signals")
    parser.add_argument("--features", type=Path, default=None)
    args = parser.parse_args()

    feat_path = args.features or (features_dir() / "daily.parquet")
    if not feat_path.exists():
        raise FileNotFoundError(f"Missing features: {feat_path}. Run build_features first.")

    feat = pd.read_parquet(feat_path)
    feat["date"] = pd.to_datetime(feat["date"]).dt.date
    ranked = rank_all(feat)
    out = signals_dir() / "ranks_all.parquet"
    ranked.to_parquet(out, index=False)

    entries = latest_entries(ranked)
    print(f"Wrote ranks -> {out}")
    print(f"Latest date {ranked['date'].max()}: {len(entries)} entry signals")
    if not entries.empty:
        print(entries[["symbol", "score", "rs_20d", "adv_20d"]].head(12).to_string(index=False))


if __name__ == "__main__":
    main()
