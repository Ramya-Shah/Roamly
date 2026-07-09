"""
Real-market dataset fetcher for Project Alpha-Forge.

Downloads one day of Bybit's official, free, public historical market data
(no API key required) for a linear perpetual symbol - full L2 order-book
depth (up to 500 levels) plus trades - truncates it to a bounded time window
(full-day files run 30-300+ MB and would take longer to replay than
BACKTEST_TIMEOUT_SECONDS allows even for a correct strategy; --minutes
should be sized to fit comfortably within that limit), and converts it with
hftbacktest's own official
``bybithistmktdata`` converter into the native replay format consumed by
``backtest_runner.py``. A companion calibration file
(``mid_price``/``event_price``/``event_time``) is derived from the same
real trades and a real reconstructed order-book mid-price series, for
``fetch_regime_calibration``.

Data sources (public, unauthenticated, confirmed reachable):
    - Depth:  https://quote-saver.bycsi.com/orderbook/linear/{symbol}/{date}_{symbol}_ob500.data.zip
    - Trades: https://public.bybit.com/trading/{symbol}/{symbol}{date}.csv.gz

This is a development/data-acquisition utility, not part of the running
services - run it once (or per dataset you want) to populate
``historical_data/`` with real market data, in place of or alongside the
synthetic data from ``generate_sample_data.py``.

Run inside the sandbox image (already has hftbacktest + numpy + a trusted
corporate CA for the download), e.g.:

    docker run --rm --entrypoint python \\
        -v "$(pwd)/certs:/app/certs:ro" \\
        -v "$(pwd)/historical_data:/out" \\
        -e SSL_CERT_FILE=/app/certs/ca-bundle.pem \\
        -v "$(pwd)/fetch_real_data.py:/fetch_real_data.py" \\
        alpha_forge-sandbox_execution /fetch_real_data.py \\
        --symbol SUIUSDT --date 2024-06-01 --minutes 15 --out-dir /out
"""

from __future__ import annotations

import argparse
import bisect
import gzip
import io
import json
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

import numpy as np

DEPTH_URL_TEMPLATE = "https://quote-saver.bycsi.com/orderbook/linear/{symbol}/{date}_{symbol}_ob500.data.zip"
TRADES_URL_TEMPLATE = "https://public.bybit.com/trading/{symbol}/{symbol}{date}.csv.gz"


def _download(url: str, dest: Path) -> None:
    print(f"Downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(dest, "wb") as f:
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    print(f"  -> {dest} ({dest.stat().st_size / 1e6:.1f} MB)")


class _BookState:
    """Minimal L2 book replica, used only to derive a real mid-price series
    for calibration - independent of whatever hftbacktest's own converter
    does internally to build the replay file."""

    def __init__(self) -> None:
        self.bids: dict[float, float] = {}
        self.asks: dict[float, float] = {}

    def apply(self, msg_type: str, data: dict[str, Any]) -> None:
        if msg_type == "snapshot":
            if "b" in data:
                self.bids = {float(p): float(q) for p, q in data["b"]}
            if "a" in data:
                self.asks = {float(p): float(q) for p, q in data["a"]}
        else:
            for p, q in data.get("b", []):
                p, q = float(p), float(q)
                if q == 0:
                    self.bids.pop(p, None)
                else:
                    self.bids[p] = q
            for p, q in data.get("a", []):
                p, q = float(p), float(q)
                if q == 0:
                    self.asks.pop(p, None)
                else:
                    self.asks[p] = q

    def mid_price(self) -> float | None:
        if not self.bids or not self.asks:
            return None
        best_bid = max(self.bids)
        best_ask = min(self.asks)
        if best_ask <= best_bid:
            return None
        return (best_bid + best_ask) / 2.0


def _truncate_depth(
    zip_path: Path, window_end_ms: int, truncated_zip_path: Path
) -> tuple[list[int], list[float]]:
    """Keep only lines up to ``window_end_ms``; return a (timestamps, mid_prices)
    series reconstructed from the real book while streaming through it."""
    book = _BookState()
    mid_timestamps: list[int] = []
    mid_prices: list[float] = []
    kept_lines: list[bytes] = []

    with zipfile.ZipFile(zip_path) as zf:
        member = zf.namelist()[0]
        with zf.open(member) as f:
            for line in f:
                obj = json.loads(line)
                ts_ms = int(obj["ts"])
                if ts_ms > window_end_ms:
                    break
                kept_lines.append(line)
                book.apply(obj["type"], obj["data"])
                mid = book.mid_price()
                if mid is not None:
                    mid_timestamps.append(ts_ms)
                    mid_prices.append(mid)

    with zipfile.ZipFile(truncated_zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(member, b"".join(kept_lines))

    print(f"  Depth: kept {len(kept_lines)} lines up to t+{(window_end_ms - int(json.loads(kept_lines[0])['ts']))/1000:.0f}s")
    return mid_timestamps, mid_prices


def _truncate_trades(
    csv_gz_path: Path, window_end_sec: float, truncated_csv_gz_path: Path
) -> list[tuple[float, float]]:
    """Keep only trade rows up to ``window_end_sec``; return [(timestamp_sec, price), ...]."""
    kept_rows: list[str] = []
    trades: list[tuple[float, float]] = []

    with gzip.open(csv_gz_path, "rt") as f:
        header = f.readline()
        kept_rows.append(header)
        columns = header.strip().split(",")
        ts_idx = columns.index("timestamp")
        price_idx = columns.index("price")
        for line in f:
            row = line.strip().split(",")
            ts_sec = float(row[ts_idx])
            if ts_sec > window_end_sec:
                break
            kept_rows.append(line)
            trades.append((ts_sec, float(row[price_idx])))

    with gzip.open(truncated_csv_gz_path, "wt") as f:
        f.writelines(kept_rows)

    print(f"  Trades: kept {len(trades)} rows")
    return trades


def _build_calibration(
    mid_timestamps: list[int], mid_prices: list[float], trades: list[tuple[float, float]]
) -> dict[str, np.ndarray]:
    """Pair each real trade with the real reconstructed mid-price at (or just
    before) its timestamp, in the schema fetch_regime_calibration expects."""
    mid_ts_sec = [t / 1000.0 for t in mid_timestamps]

    cal_mid: list[float] = []
    cal_event_price: list[float] = []
    cal_event_time: list[float] = []

    for trade_ts, trade_price in trades:
        idx = bisect.bisect_right(mid_ts_sec, trade_ts) - 1
        if idx < 0:
            continue
        cal_mid.append(mid_prices[idx])
        cal_event_price.append(trade_price)
        cal_event_time.append(trade_ts)

    return {
        "mid_price": np.asarray(cal_mid, dtype=np.float64),
        "event_price": np.asarray(cal_event_price, dtype=np.float64),
        "event_time": np.asarray(cal_event_time, dtype=np.float64),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch a real Bybit LOB sample for Alpha-Forge")
    parser.add_argument("--symbol", required=True, help="Bybit linear perpetual symbol, e.g. SUIUSDT")
    parser.add_argument("--date", required=True, help="UTC date, YYYY-MM-DD")
    parser.add_argument("--minutes", type=int, default=15, help="Window length from the start of the day")
    parser.add_argument("--out-dir", type=Path, default=Path("."))
    parser.add_argument("--buffer-size", type=int, default=2_000_000)
    parser.add_argument(
        "--output-prefix", default=None,
        help="Output filename prefix (default '<symbol>_real'). Use a distinct prefix "
             "to fetch e.g. an out-of-sample window alongside the training one.",
    )
    args = parser.parse_args()

    from hftbacktest.data.utils import bybithistmktdata

    args.out_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir = args.out_dir / "_tmp_real_fetch"
    tmp_dir.mkdir(exist_ok=True)

    depth_zip = tmp_dir / f"{args.symbol}_{args.date}_depth.zip"
    trades_gz = tmp_dir / f"{args.symbol}_{args.date}_trades.csv.gz"
    truncated_zip = tmp_dir / f"{args.symbol}_{args.date}_depth_truncated.zip"
    truncated_gz = tmp_dir / f"{args.symbol}_{args.date}_trades_truncated.csv.gz"

    _download(DEPTH_URL_TEMPLATE.format(symbol=args.symbol, date=args.date), depth_zip)
    _download(TRADES_URL_TEMPLATE.format(symbol=args.symbol, date=args.date), trades_gz)

    with zipfile.ZipFile(depth_zip) as zf:
        with zf.open(zf.namelist()[0]) as f:
            first_ts_ms = int(json.loads(f.readline())["ts"])
    window_end_ms = first_ts_ms + args.minutes * 60_000

    print(f"Truncating to the first {args.minutes} minute(s) of {args.date}...")
    mid_timestamps, mid_prices = _truncate_depth(depth_zip, window_end_ms, truncated_zip)
    trades = _truncate_trades(trades_gz, window_end_ms / 1000.0, truncated_gz)

    prefix = args.output_prefix or f"{args.symbol.lower()}_real"
    replay_path = args.out_dir / f"{prefix}_replay.npz"
    calibration_path = args.out_dir / f"{prefix}_calibration.npz"

    print("Converting via hftbacktest's official bybithistmktdata converter...")
    bybithistmktdata.convert(
        depth_filename=str(truncated_zip),
        trades_filename=str(truncated_gz),
        output_filename=str(replay_path),
        buffer_size=args.buffer_size,
    )

    calibration = _build_calibration(mid_timestamps, mid_prices, trades)
    np.savez(calibration_path, **calibration)

    for f in (depth_zip, trades_gz, truncated_zip, truncated_gz):
        f.unlink(missing_ok=True)
    tmp_dir.rmdir()

    print(f"Wrote real replay dataset to {replay_path}")
    print(f"Wrote real calibration dataset to {calibration_path} ({len(calibration['event_time'])} trades)")


if __name__ == "__main__":
    main()
