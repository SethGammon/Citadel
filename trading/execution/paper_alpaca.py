#!/usr/bin/env python3
"""
Weekly paper rebalance via Alpaca. Falls back to dry-run audit log without API keys.

Env:
  ALPACA_API_KEY, ALPACA_SECRET_KEY
  ALPACA_PAPER=1 (default)
  TRADING_DRY_RUN=1 — log orders only, no broker calls
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from trading.lib.config import load_spec
from trading.lib.paths import audit_dir, features_dir, signals_dir
from trading.strategy.rank_long import latest_entries, rank_all


def audit_log(record: dict) -> Path:
    audit_dir().mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = audit_dir() / f"paper_{ts}.jsonl"
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")
    return path


def get_account_equity() -> float:
    key = os.environ.get("ALPACA_API_KEY")
    secret = os.environ.get("ALPACA_SECRET_KEY")
    if not key or not secret:
        return 100_000.0
    from alpaca.trading.client import TradingClient

    paper = os.environ.get("ALPACA_PAPER", "1") == "1"
    client = TradingClient(key, secret, paper=paper)
    acct = client.get_account()
    return float(acct.equity)


def submit_orders(symbols: list[str], equity: float, max_positions: int, dry_run: bool) -> list[dict]:
    if not symbols:
        return []

    weight = 1.0 / max(len(symbols), 1)
    records = []
    key = os.environ.get("ALPACA_API_KEY")
    secret = os.environ.get("ALPACA_SECRET_KEY")

    client = None
    if not dry_run and key and secret:
        from alpaca.trading.client import TradingClient
        from alpaca.trading.requests import MarketOrderRequest
        from alpaca.trading.enums import OrderSide, TimeInForce

        paper = os.environ.get("ALPACA_PAPER", "1") == "1"
        client = TradingClient(key, secret, paper=paper)

    for sym in symbols[:max_positions]:
        notional = equity * weight * 0.98
        rec = {
            "symbol": sym,
            "side": "buy",
            "notional_usd": round(notional, 2),
            "dry_run": dry_run,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if client and not dry_run:
            try:
                req = MarketOrderRequest(
                    symbol=sym,
                    notional=notional,
                    side=OrderSide.BUY,
                    time_in_force=TimeInForce.DAY,
                )
                order = client.submit_order(req)
                rec["order_id"] = str(order.id)
                rec["status"] = str(order.status)
            except Exception as e:
                rec["error"] = str(e)
        records.append(rec)
    return records


def rebalance(dry_run: bool | None = None) -> dict:
    spec = load_spec()
    dry_run = dry_run if dry_run is not None else os.environ.get("TRADING_DRY_RUN", "1") == "1"
    max_pos = int(spec.get("max_positions", 12))

    feat_path = features_dir() / "daily.parquet"
    if not feat_path.exists():
        raise FileNotFoundError("Run pipeline through build_features first")

    feat = pd.read_parquet(feat_path)
    feat["date"] = pd.to_datetime(feat["date"]).dt.date
    ranked = rank_all(feat)
    ranked.to_parquet(signals_dir() / "ranks_all.parquet", index=False)
    entries = latest_entries(ranked)
    symbols = entries["symbol"].tolist()

    equity = get_account_equity()
    orders = submit_orders(symbols, equity, max_pos, dry_run=dry_run)

    payload = {
        "as_of_date": str(entries["date"].iloc[0]) if not entries.empty else None,
        "equity": equity,
        "targets": symbols,
        "orders": orders,
        "dry_run": dry_run,
    }
    log_path = audit_log(payload)
    payload["audit_path"] = str(log_path)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Paper rebalance (Alpaca or dry-run)")
    parser.add_argument("--live", action="store_true", help="Submit real paper orders (requires API keys)")
    args = parser.parse_args()

    result = rebalance(dry_run=not args.live)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
