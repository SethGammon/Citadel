from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]


def config_dir() -> Path:
    return TRADING_ROOT / "config"


def data_dir() -> Path:
    return TRADING_ROOT / "data"


def prices_dir() -> Path:
    d = data_dir() / "prices"
    d.mkdir(parents=True, exist_ok=True)
    return d


def amplitude_dir() -> Path:
    d = data_dir() / "amplitude"
    d.mkdir(parents=True, exist_ok=True)
    return d


def universe_dir() -> Path:
    d = data_dir() / "universe"
    d.mkdir(parents=True, exist_ok=True)
    return d


def features_dir() -> Path:
    d = data_dir() / "features"
    d.mkdir(parents=True, exist_ok=True)
    return d


def signals_dir() -> Path:
    d = data_dir() / "signals"
    d.mkdir(parents=True, exist_ok=True)
    return d


def backtest_dir() -> Path:
    d = data_dir() / "backtest"
    d.mkdir(parents=True, exist_ok=True)
    return d


def audit_dir() -> Path:
    d = data_dir() / "audit"
    d.mkdir(parents=True, exist_ok=True)
    return d
