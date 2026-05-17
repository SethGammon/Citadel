# Trading pipeline (NYSE / NASDAQ swing)

Swing, long-only NASDAQ-100 strategy using price data + optional Amplitude engagement metrics.

## Setup

```bash
cd /path/to/Untitled
python3 -m venv .venv-trading
source .venv-trading/bin/activate
pip install -r trading/requirements.txt
```

Optional Alpaca paper keys in `.env`:

```
ALPACA_API_KEY=...
ALPACA_SECRET_KEY=...
ALPACA_PAPER=1
```

Amplitude CSV exports:

```
AMPLITUDE_EXPORT_DIR=/path/to/exports
```

## Run full pipeline

```bash
python trading/run_pipeline.py --years 3
```

Steps: universe → prices (yfinance or Alpaca) → Amplitude sample/CSV → features → ranks → backtest → paper dry-run audit.

## Individual commands

```bash
python -m trading.ingest.fetch_universe --years 5
python -m trading.ingest.fetch_prices --years 5
python -m trading.ingest.fetch_amplitude --sample
python -m trading.features.build_features
python -m trading.strategy.rank_long
python -m trading.backtest.run_backtest
python -m trading.execution.paper_alpaca          # dry-run
python -m trading.execution.paper_alpaca --live  # Alpaca paper orders
```

## Config

- [`config/spec.yaml`](config/spec.yaml) — horizon, sizing, costs, lag
- [`config/ticker_map.yaml`](config/ticker_map.yaml) — Amplitude key → symbol
- [`config/nasdaq100_symbols.yaml`](config/nasdaq100_symbols.yaml) — universe

## Outputs

Data under `trading/data/` (gitignored). See [`store/schema.md`](store/schema.md).

## Compliance

Do not trade on MNPI. Map only issuers you are permitted to analyze. Backtest does not guarantee future returns.
