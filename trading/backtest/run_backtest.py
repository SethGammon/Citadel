#!/usr/bin/env python3
"""Walk-forward weekly backtest with costs vs benchmark."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from trading.lib.config import load_spec
from trading.lib.paths import backtest_dir, features_dir, prices_dir, signals_dir
from trading.strategy.rank_long import rank_all


def load_prices_wide(symbols: list[str]) -> pd.DataFrame:
    frames = []
    for sym in symbols:
        p = prices_dir() / f"{sym}.parquet"
        if not p.exists():
            continue
        df = pd.read_parquet(p)[["date", "close"]]
        df["date"] = pd.to_datetime(df["date"]).dt.date
        df = df.rename(columns={"close": sym})
        frames.append(df.set_index("date"))
    if not frames:
        return pd.DataFrame()
    out = pd.concat(frames, axis=1).sort_index()
    return out


def weekly_rebalance_dates(dates: list[date]) -> list[date]:
    """Mondays (or first trading day of week) from sorted date list."""
    s = pd.Series(dates)
    df = pd.DataFrame({"date": pd.to_datetime(s)})
    df["week"] = df["date"].dt.isocalendar().week.astype(int)
    df["year"] = df["date"].dt.isocalendar().year.astype(int)
    first = df.groupby(["year", "week"])["date"].min()
    return [d.date() for d in first]


def run_backtest(
    ranked: pd.DataFrame,
    prices: pd.DataFrame,
    benchmark: str,
    spec: dict,
) -> tuple[dict, pd.DataFrame]:
    max_pos = int(spec.get("max_positions", 12))
    max_hold = int(spec.get("max_hold_sessions", 10))
    cost_bps = float(spec.get("commission_bps", 5)) + float(spec.get("slippage_bps", 5))
    cost_rate = cost_bps / 10_000.0

    dates = sorted(ranked["date"].unique())
    rebalance_dates = set(weekly_rebalance_dates(dates))

    holdings: dict[str, dict] = {}
    equity = 1.0
    bench_equity = 1.0
    curve = []
    trades = 0

    price_dates = sorted(prices.index.unique())
    bench_col = benchmark if benchmark in prices.columns else prices.columns[0]

    for i, d in enumerate(price_dates):
        if d not in prices.index:
            continue
        row = prices.loc[d]

        if d in rebalance_dates:
            day_rank = ranked[ranked["date"] == d]
            targets = day_rank[day_rank["enter"]].sort_values("score", ascending=False).head(max_pos)
            target_syms = set(targets["symbol"].tolist())

            for sym in list(holdings.keys()):
                if sym not in target_syms or sym not in row or pd.isna(row[sym]):
                    equity *= 1 - cost_rate
                    trades += 1
                    del holdings[sym]

            n_new = max_pos - len(holdings)
            for sym in targets["symbol"]:
                if n_new <= 0:
                    break
                if sym in holdings or sym not in row or pd.isna(row[sym]):
                    continue
                holdings[sym] = {"entry_date": d, "entry_price": float(row[sym])}
                equity *= 1 - cost_rate
                trades += 1
                n_new -= 1

        day_ret = 0.0
        to_close = []
        for sym, meta in holdings.items():
            if sym not in row or pd.isna(row[sym]):
                continue
            px = float(row[sym])
            prev_idx = price_dates.index(d) - 1
            if prev_idx < 0:
                continue
            prev_d = price_dates[prev_idx]
            if sym not in prices.columns or pd.isna(prices.loc[prev_d, sym]):
                continue
            prev_px = float(prices.loc[prev_d, sym])
            day_ret += (px / prev_px - 1) / max(len(holdings), 1)

            hold_days = (d - meta["entry_date"]).days
            day_sig = ranked[(ranked["date"] == d) & (ranked["symbol"] == sym)]
            exit_sig = bool(day_sig["exit"].iloc[0]) if not day_sig.empty else False
            if hold_days >= max_hold * 2 or exit_sig:
                to_close.append(sym)

        for sym in to_close:
            equity *= 1 - cost_rate
            trades += 1
            del holdings[sym]

        equity *= 1 + day_ret

        if i > 0:
            prev_d = price_dates[i - 1]
            if bench_col in prices.columns and bench_col in row.index:
                b0, b1 = float(prices.loc[prev_d, bench_col]), float(row[bench_col])
                if not np.isnan(b0) and b0 > 0 and not np.isnan(b1):
                    bench_equity *= b1 / b0

        curve.append({"date": d, "equity": equity, "bench_equity": bench_equity, "n_positions": len(holdings)})

    curve_df = pd.DataFrame(curve)
    if curve_df.empty:
        return {"error": "no curve"}, curve_df

    curve_df["strat_ret"] = curve_df["equity"].pct_change().fillna(0)
    curve_df["bench_ret"] = curve_df["bench_equity"].pct_change().fillna(0)

    strat_vol = curve_df["strat_ret"].std() * np.sqrt(252) or 1e-9
    sharpe = (curve_df["strat_ret"].mean() * 252) / strat_vol
    dd = (curve_df["equity"] / curve_df["equity"].cummax() - 1).min()
    years = max((curve_df["date"].iloc[-1] - curve_df["date"].iloc[0]).days / 365.25, 1e-6)
    cagr = (equity ** (1 / years)) - 1
    bench_cagr = (bench_equity ** (1 / years)) - 1

    summary = {
        "cagr": round(cagr, 4),
        "benchmark_cagr": round(bench_cagr, 4),
        "excess_cagr": round(cagr - bench_cagr, 4),
        "sharpe": round(float(sharpe), 3),
        "max_drawdown": round(float(dd), 4),
        "trades": trades,
        "final_equity": round(equity, 4),
        "curve_rows": len(curve_df),
    }
    return summary, curve_df


def main() -> None:
    parser = argparse.ArgumentParser(description="Run walk-forward backtest")
    args = parser.parse_args()

    spec = load_spec()
    benchmark = spec.get("benchmark", "QQQ")

    feat_path = features_dir() / "daily.parquet"
    if not feat_path.exists():
        raise FileNotFoundError("Run build_features first")

    feat = pd.read_parquet(feat_path)
    feat["date"] = pd.to_datetime(feat["date"]).dt.date
    ranked = rank_all(feat)
    ranked.to_parquet(signals_dir() / "ranks_all.parquet", index=False)

    symbols = sorted(feat["symbol"].unique()) + [benchmark]
    prices = load_prices_wide(symbols)
    if prices.empty:
        raise FileNotFoundError("Run fetch_prices first")

    result, curve_df = run_backtest(ranked, prices, benchmark, spec)
    out_json = backtest_dir() / "summary.json"
    out_json.write_text(json.dumps({k: v for k, v in result.items() if k != "curve_df"}, indent=2), encoding="utf-8")
    curve_path = backtest_dir() / "equity_curve.parquet"
    if not curve_df.empty:
        curve_df.to_parquet(curve_path, index=False)

    print(json.dumps({k: v for k, v in result.items() if k != "curve_df"}, indent=2))
    print(f"Summary -> {out_json}")
    if not curve_df.empty:
        print(f"Curve -> {curve_path}")


if __name__ == "__main__":
    main()
