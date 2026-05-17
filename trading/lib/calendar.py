from __future__ import annotations

from datetime import date, timedelta

import pandas as pd


def trading_days_between(start: date, end: date) -> list[date]:
    """US equity business days (weekdays; no holiday calendar in v1)."""
    bdays = pd.bdate_range(start=start, end=end)
    return [d.date() for d in bdays]


def add_business_days(d: date, n: int) -> date:
    if n <= 0:
        return d
    days = trading_days_between(d, d + timedelta(days=n * 3 + 30))
    if d not in days:
        days = sorted(set([d] + days))
    idx = days.index(d) if d in days else 0
    target = idx + n
    if target < len(days):
        return days[target]
    extra = trading_days_between(d, d + timedelta(days=n * 5 + 90))
    return extra[min(target, len(extra) - 1)]


def apply_alt_lag(as_of: date, lag_days: int) -> date:
    return add_business_days(as_of, lag_days)
