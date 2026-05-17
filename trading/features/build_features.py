#!/usr/bin/env python3
"""Build point-in-time feature table from prices + Amplitude metrics."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from trading.lib.calendar import apply_alt_lag
from trading.lib.config import load_spec, load_ticker_map, map_key_to_symbol
from trading.lib.paths import amplitude_dir, features_dir, prices_dir


def load_all_prices(symbols: list[str]) -> pd.DataFrame:
    frames = []
    for sym in symbols:
        path = prices_dir() / f"{sym}.parquet"
        if not path.exists():
            continue
        df = pd.read_parquet(path)
        df["symbol"] = sym
        frames.append(df)
    if not frames:
        return pd.DataFrame()
    out = pd.concat(frames, ignore_index=True)
    out["date"] = pd.to_datetime(out["date"]).dt.date
    return out.sort_values(["symbol", "date"])


def load_amplitude_metrics() -> pd.DataFrame:
    amp_dir = amplitude_dir()
    if not amp_dir.exists():
        return pd.DataFrame()
    frames = []
    for p in amp_dir.glob("*.parquet"):
        df = pd.read_parquet(p)
        if "metric_name" not in df.columns:
            df["metric_name"] = p.stem
        frames.append(df)
    if not frames:
        return pd.DataFrame()
    combined = pd.concat(frames, ignore_index=True)
    combined["as_of_date"] = pd.to_datetime(combined["as_of_date"]).dt.date
    return combined


def price_features(prices: pd.DataFrame, benchmark: str, spec: dict) -> pd.DataFrame:
    sma_p = int(spec.get("sma_period", 20))
    rs_p = int(spec.get("rs_period", 20))
    adv_p = int(spec.get("adv_period", 20))

    bench = prices[prices["symbol"] == benchmark][["date", "close"]].rename(
        columns={"close": "bench_close"}
    )

    rows = []
    for symbol, grp in prices.groupby("symbol"):
        if symbol == benchmark:
            continue
        g = grp.sort_values("date").copy()
        g["sma"] = g["close"].rolling(sma_p).mean()
        g["adv_20d"] = (g["close"] * g["volume"]).rolling(adv_p).mean()
        g["ret"] = g["close"].pct_change()
        g = g.merge(bench, on="date", how="left")
        g["bench_ret"] = g["bench_close"].pct_change()
        g["rs_20d"] = g["close"].pct_change(rs_p) - g["bench_close"].pct_change(rs_p)
        g["high_52w"] = g["close"].rolling(252, min_periods=60).max()
        g["dist_52w_high"] = (g["close"] / g["high_52w"]) - 1.0

        for _, r in g.iterrows():
            if pd.isna(r.get("sma")):
                continue
            rows.append(
                {
                    "date": r["date"],
                    "symbol": symbol,
                    "close": float(r["close"]),
                    "rs_20d": float(r["rs_20d"]) if pd.notna(r["rs_20d"]) else 0.0,
                    "adv_20d": float(r["adv_20d"]) if pd.notna(r["adv_20d"]) else 0.0,
                    "dist_52w_high": float(r["dist_52w_high"]) if pd.notna(r["dist_52w_high"]) else 0.0,
                    "above_sma20": bool(r["close"] > r["sma"]),
                }
            )
    return pd.DataFrame(rows)


def alt_features(amp: pd.DataFrame, ticker_map: dict, lag_days: int) -> pd.DataFrame:
    if amp.empty:
        return pd.DataFrame()

    wau = amp[amp["metric_name"].str.contains("wau|dau", case=False, regex=True)]
    ret = amp[amp["metric_name"].str.contains("retention", case=False)]
    conv = amp[amp["metric_name"].str.contains("conversion", case=False)]

    def pivot_metric(df: pd.DataFrame, col: str) -> pd.DataFrame:
        if df.empty:
            return pd.DataFrame()
        rows = []
        for map_key, grp in df.groupby("map_key"):
            sym = map_key_to_symbol(str(map_key), ticker_map)
            if not sym:
                continue
            g = grp.sort_values("as_of_date")
            g["value_prev"] = g["value"].shift(1)
            g[col] = (g["value"] / g["value_prev"]) - 1.0
            for _, r in g.iterrows():
                avail = apply_alt_lag(r["as_of_date"], lag_days)
                rows.append({"date": avail, "symbol": sym, col: float(r[col]) if pd.notna(r[col]) else 0.0})
        return pd.DataFrame(rows)

    def retention_slope(df: pd.DataFrame) -> pd.DataFrame:
        if df.empty:
            return pd.DataFrame()
        rows = []
        for map_key, grp in df.groupby("map_key"):
            sym = map_key_to_symbol(str(map_key), ticker_map)
            if not sym:
                continue
            g = grp.sort_values("as_of_date")
            g["ma4"] = g["value"].rolling(4, min_periods=2).mean()
            g["retention_slope"] = g["value"] - g["ma4"]
            for _, r in g.iterrows():
                avail = apply_alt_lag(r["as_of_date"], lag_days)
                rows.append(
                    {
                        "date": avail,
                        "symbol": sym,
                        "retention_slope": float(r["retention_slope"]) if pd.notna(r["retention_slope"]) else 0.0,
                    }
                )
        return pd.DataFrame(rows)

    def conversion_delta(df: pd.DataFrame) -> pd.DataFrame:
        if df.empty:
            return pd.DataFrame()
        rows = []
        for map_key, grp in df.groupby("map_key"):
            sym = map_key_to_symbol(str(map_key), ticker_map)
            if not sym:
                continue
            g = grp.sort_values("as_of_date")
            g["delta"] = g["value"].diff()
            for _, r in g.iterrows():
                avail = apply_alt_lag(r["as_of_date"], lag_days)
                rows.append(
                    {
                        "date": avail,
                        "symbol": sym,
                        "conversion_delta": float(r["delta"]) if pd.notna(r["delta"]) else 0.0,
                    }
                )
        return pd.DataFrame(rows)

    parts = [
        pivot_metric(wau, "dau_wow"),
        retention_slope(ret),
        conversion_delta(conv),
    ]
    parts = [p for p in parts if not p.empty]
    if not parts:
        return pd.DataFrame()

    merged = parts[0]
    for p in parts[1:]:
        merged = merged.merge(p, on=["date", "symbol"], how="outer")
    return merged.fillna(0.0)


def zscore_by_date(df: pd.DataFrame, col: str) -> pd.Series:
    out = pd.Series(0.0, index=df.index)
    for _, g in df.groupby("date"):
        s = g[col]
        if s.std() == 0 or len(s) < 2:
            out.loc[g.index] = 0.0
        else:
            out.loc[g.index] = (s - s.mean()) / s.std()
    return out


def build(spec: dict | None = None) -> pd.DataFrame:
    spec = spec or load_spec()
    ticker_map = load_ticker_map()
    symbols = sorted({v["symbol"] for v in ticker_map.values()} | {spec.get("benchmark", "QQQ")})

    prices = load_all_prices(symbols)
    if prices.empty:
        raise FileNotFoundError("No price data. Run: python -m trading.ingest.fetch_prices")

    pf = price_features(prices, spec.get("benchmark", "QQQ"), spec)
    af = alt_features(load_amplitude_metrics(), ticker_map, int(spec.get("alt_data_lag_days", 1)))

    if af.empty:
        feat = pf.copy()
        feat["dau_wow"] = 0.0
        feat["retention_slope"] = 0.0
        feat["conversion_delta"] = 0.0
    else:
        feat = pf.merge(af, on=["date", "symbol"], how="left").fillna(0.0)

    for col in ("dau_wow", "retention_slope", "conversion_delta"):
        if col not in feat.columns:
            feat[col] = 0.0
        feat[f"z_{col}"] = zscore_by_date(feat, col)

    feat["score"] = (
        feat["z_dau_wow"]
        + feat["z_retention_slope"]
        + 0.5 * feat["z_conversion_delta"]
    )
    return feat.sort_values(["date", "symbol"])


def main() -> None:
    parser = argparse.ArgumentParser(description="Build feature table")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    feat = build()
    out = args.output or (features_dir() / "daily.parquet")
    feat.to_parquet(out, index=False)
    print(f"Wrote {len(feat)} rows -> {out}")


if __name__ == "__main__":
    main()
