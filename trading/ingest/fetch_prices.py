#!/usr/bin/env python3
"""Download daily OHLCV bars to trading/data/prices/{SYMBOL}.parquet."""

from __future__ import annotations

import argparse
import os
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import yaml

from trading.lib.paths import config_dir, prices_dir


def load_symbols(extra: list[str] | None = None) -> list[str]:
    path = config_dir() / "nasdaq100_symbols.yaml"
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    symbols = {s.upper() for s in (data.get("symbols") or [])}
    spec_path = config_dir() / "spec.yaml"
    with spec_path.open(encoding="utf-8") as f:
        spec = yaml.safe_load(f) or {}
    symbols.add(spec.get("benchmark", "QQQ").upper())
    if extra:
        symbols.update(s.upper() for s in extra)
    return sorted(symbols)


def fetch_alpaca(symbol: str, start: date, end: date) -> pd.DataFrame | None:
    key = os.environ.get("ALPACA_API_KEY")
    secret = os.environ.get("ALPACA_SECRET_KEY")
    if not key or not secret:
        return None
    try:
        from alpaca.data.historical import StockHistoricalDataClient
        from alpaca.data.requests import StockBarsRequest
        from alpaca.data.timeframe import TimeFrame
    except ImportError:
        return None

    client = StockHistoricalDataClient(key, secret)
    req = StockBarsRequest(
        symbol_or_symbols=symbol,
        timeframe=TimeFrame.Day,
        start=start,
        end=end,
    )
    bars = client.get_stock_bars(req).df
    if bars is None or bars.empty:
        return None
    if isinstance(bars.index, pd.MultiIndex):
        bars = bars.reset_index()
    else:
        bars = bars.reset_index()
    rename = {
        "timestamp": "date",
        "open": "open",
        "high": "high",
        "low": "low",
        "close": "close",
        "volume": "volume",
    }
    cols = [c for c in bars.columns if c in rename or c == "close"]
    df = bars.rename(columns=rename)
    if "date" not in df.columns and "timestamp" in bars.columns:
        df["date"] = pd.to_datetime(bars["timestamp"]).dt.tz_localize(None).dt.date
    df["date"] = pd.to_datetime(df["date"]).dt.date
    df["adj_close"] = df["close"]
    return df[["date", "open", "high", "low", "close", "volume", "adj_close"]]


def fetch_yfinance(symbol: str, start: date, end: date) -> pd.DataFrame:
    import yfinance as yf

    ticker = yf.Ticker(symbol)
    hist = ticker.history(start=start.isoformat(), end=(end + timedelta(days=1)).isoformat(), auto_adjust=True)
    if hist.empty:
        return pd.DataFrame()
    hist = hist.reset_index()
    hist["date"] = pd.to_datetime(hist["Date"]).dt.date
    df = pd.DataFrame(
        {
            "date": hist["date"],
            "open": hist["Open"].astype(float),
            "high": hist["High"].astype(float),
            "low": hist["Low"].astype(float),
            "close": hist["Close"].astype(float),
            "volume": hist["Volume"].astype("int64"),
            "adj_close": hist["Close"].astype(float),
        }
    )
    return df


def fetch_symbol(symbol: str, start: date, end: date) -> pd.DataFrame:
    df = fetch_alpaca(symbol, start, end)
    if df is None or df.empty:
        df = fetch_yfinance(symbol, start, end)
    return df


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch daily price bars")
    parser.add_argument("--years", type=int, default=5)
    parser.add_argument("--symbols", nargs="*", default=None)
    args = parser.parse_args()

    end = date.today()
    start = end - timedelta(days=365 * args.years)
    symbols = args.symbols or load_symbols()
    out_dir = prices_dir()

    ok, fail = 0, 0
    for sym in symbols:
        try:
            df = fetch_symbol(sym, start, end)
            if df.empty:
                print(f"SKIP {sym}: no data")
                fail += 1
                continue
            path = out_dir / f"{sym}.parquet"
            df.to_parquet(path, index=False)
            print(f"OK {sym}: {len(df)} rows -> {path}")
            ok += 1
        except Exception as e:
            print(f"FAIL {sym}: {e}")
            fail += 1

    print(f"Done: {ok} ok, {fail} failed")


if __name__ == "__main__":
    main()
