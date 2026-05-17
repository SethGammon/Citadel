#!/usr/bin/env python3
"""Run full ingest -> features -> ranks -> backtest pipeline."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # repo root (Untitled)


def run(cmd: list[str]) -> None:
    print(f"\n>> {' '.join(cmd)}")
    env = {**os.environ, "PYTHONPATH": str(ROOT)}
    subprocess.check_call(cmd, cwd=ROOT, env=env)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run trading pipeline")
    parser.add_argument("--years", type=int, default=3)
    parser.add_argument("--skip-prices", action="store_true")
    parser.add_argument("--sample-amplitude", action="store_true", default=True)
    parser.add_argument("--no-sample-amplitude", action="store_false", dest="sample_amplitude")
    args = parser.parse_args()

    py = sys.executable

    if not args.skip_prices:
        run([py, "-m", "trading.ingest.fetch_universe", "--years", str(args.years)])
        run([py, "-m", "trading.ingest.fetch_prices", "--years", str(args.years)])

    if args.sample_amplitude:
        run([py, "-m", "trading.ingest.fetch_amplitude", "--sample"])

    run([py, "-m", "trading.features.build_features"])
    run([py, "-m", "trading.strategy.rank_long"])
    run([py, "-m", "trading.backtest.run_backtest"])

    print("\nPipeline complete. Paper rebalance (dry-run):")
    run([py, "-m", "trading.execution.paper_alpaca"])


if __name__ == "__main__":
    main()
