# Parquet warehouse schema

## `data/prices/{SYMBOL}.parquet`

| Column | Type | Description |
|--------|------|-------------|
| date | date | US session date (America/New_York) |
| open | float | |
| high | float | |
| low | float | |
| close | float | |
| volume | int64 | |
| adj_close | float | Split/dividend adjusted close |

## `data/universe/nasdaq100_membership.parquet`

| Column | Type | Description |
|--------|------|-------------|
| date | date | Rebalance / as-of date |
| symbol | string | Ticker |
| in_index | bool | Member on that date |

## `data/amplitude/{metric}.parquet`

| Column | Type | Description |
|--------|------|-------------|
| as_of_date | date | Metric period end |
| map_key | string | Join key for ticker_map.yaml |
| metric_name | string | e.g. dau, wau, retention_d7 |
| value | float | |
| segment | string | Optional; default `all` |

## `data/features/daily.parquet`

| Column | Type | Description |
|--------|------|-------------|
| date | date | Feature availability date (post lag) |
| symbol | string | |
| dau_wow | float | |
| retention_slope | float | |
| conversion_delta | float | |
| rs_20d | float | |
| adv_20d | float | |
| dist_52w_high | float | |
| score | float | Composite z-score sum |

## `data/signals/ranks_{date}.parquet`

| Column | Type | Description |
|--------|------|-------------|
| date | date | |
| symbol | string | |
| score | float | |
| rank | int | |
| enter | bool | |
| exit | bool | |

## `data/audit/paper_{timestamp}.jsonl`

One JSON object per line: decision audit for paper orders.
