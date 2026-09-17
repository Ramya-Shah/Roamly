"""
Synthetic smoke-test dataset generator for Project Alpha-Forge.

This is a development utility, not part of the sandbox/orchestrator runtime
images. It produces two files from a single simulated order-flow process so
the pipeline can be exercised end-to-end before real exchange data is
available:

    - ``<out-dir>/sample_replay.npz``: hftbacktest's native tick-log replay
      format (a structured array under the ``data`` key, matching
      ``hftbacktest.event_dtype``, confirmed against the installed
      hftbacktest==2.4.4 source and the same convention its own
      bybit/binance/tardis converters use).
    - ``<out-dir>/sample_calibration.npz``: the ``mid_price``/``event_price``/
      ``event_time`` schema consumed by ``mcp_server.fetch_regime_calibration``.

IMPORTANT: this is a synthetic random walk, not real market data. It exists
to prove the Docker/MCP/hftbacktest wiring works, not to draw any conclusion
about real strategy performance. Replace with real tick data in
``historical_data/`` once available.

Run inside the sandbox image (which already has numpy installed), e.g.:

    docker run --rm --entrypoint python \\
        -v "$(pwd)/historical_data:/out" \\
        -v "$(pwd)/generate_sample_data.py:/generate_sample_data.py" \\
        alpha_forge-sandbox_execution /generate_sample_data.py --out-dir /out
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

# --- hftbacktest event_dtype and flag constants -----------------------------
# Mirrored here (rather than imported) so this script has no hftbacktest
# runtime dependency beyond numpy; values confirmed against the installed
# hftbacktest==2.4.4 package (hftbacktest.types / hftbacktest.__init__).
EVENT_DTYPE = np.dtype(
    [
        ("ev", "<u8"),
        ("exch_ts", "<i8"),
        ("local_ts", "<i8"),
        ("px", "<f8"),
        ("qty", "<f8"),
        ("order_id", "<u8"),
        ("ival", "<i8"),
        ("fval", "<f8"),
    ],
    align=True,
)

EXCH_EVENT = 1 << 31
LOCAL_EVENT = 1 << 30
BUY_EVENT = 1 << 29
SELL_EVENT = 1 << 28
DEPTH_EVENT = 1
TRADE_EVENT = 2
DEPTH_CLEAR_EVENT = 3
DEPTH_SNAPSHOT_EVENT = 4

# This generator treats the synthetic feed as having zero local-vs-exchange
# latency (exch_ts == local_ts for every row), so EXCH_EVENT | LOCAL_EVENT is
# OR'd onto every event up front - this is the same combination hftbacktest's
# own `data/validation.py` applies after its local-latency correction pass.
BOTH_SIDES = EXCH_EVENT | LOCAL_EVENT


def generate(
    *,
    num_levels: int = 10,
    tick_size: float = 0.01,
    start_mid: float = 100.0,
    num_steps: int = 20_000,
    mean_step_ns: int = 5_000_000,
    resnapshot_interval: int = 200,
    seed: int = 42,
) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """Simulate a random-walk limit order book and return (replay_array, calibration_dict).

    Book state is kept as ``{offset_from_mid_tick: qty}``, offsets -1..-num_levels
    for the bid side (offset -1 is best bid) and +1..+num_levels for the ask
    side (offset +1 is best ask). Rather than incrementally re-keying levels
    when the mid-price drifts (error-prone to get right for a synthetic
    generator with no correctness requirement beyond "produces a valid,
    exercisable replay"), the whole ladder is periodically torn down and
    re-emitted as a fresh ``DEPTH_SNAPSHOT_EVENT`` around a new mid tick -
    always internally consistent since every level is (re)stated from
    scratch. Between snapshots, only individual level quantities are
    perturbed or consumed by trades, never the price levels themselves.
    """
    rng = np.random.default_rng(seed)

    rows: list[tuple] = []
    calibration_mid: list[float] = []
    calibration_event_price: list[float] = []
    calibration_event_time: list[float] = []

    ts = 0
    mid_tick = round(start_mid / tick_size)

    def price_at(offset: int) -> float:
        return round((mid_tick + offset) * tick_size, 10)

    def fresh_levels() -> dict[int, float]:
        levels: dict[int, float] = {}
        for i in range(1, num_levels + 1):
            levels[-i] = float(rng.uniform(1.0, 10.0))
            levels[i] = float(rng.uniform(1.0, 10.0))
        return levels

    def emit_snapshot(levels: dict[int, float]) -> None:
        rows.append((DEPTH_CLEAR_EVENT | BUY_EVENT | BOTH_SIDES, ts, ts, 0.0, 0.0, 0, 0, 0.0))
        rows.append((DEPTH_CLEAR_EVENT | SELL_EVENT | BOTH_SIDES, ts, ts, 0.0, 0.0, 0, 0, 0.0))
        for offset, qty in levels.items():
            flag = BUY_EVENT if offset < 0 else SELL_EVENT
            rows.append((DEPTH_SNAPSHOT_EVENT | flag | BOTH_SIDES, ts, ts, price_at(offset), qty, 0, 0, 0.0))

    levels = fresh_levels()
    emit_snapshot(levels)

    for step in range(num_steps):
        ts += int(rng.exponential(mean_step_ns)) + 1

        if step > 0 and step % resnapshot_interval == 0:
            mid_tick += int(rng.choice([-1, 0, 1]))
            levels = fresh_levels()
            emit_snapshot(levels)
            continue

        action = rng.random()

        if action < 0.7:
            # Resting-liquidity random walk: perturb one existing level's qty.
            offset = int(rng.choice(list(levels.keys())))
            new_qty = max(0.1, levels[offset] + float(rng.normal(0.0, 1.0)))
            levels[offset] = new_qty
            flag = BUY_EVENT if offset < 0 else SELL_EVENT
            rows.append((DEPTH_EVENT | flag | BOTH_SIDES, ts, ts, price_at(offset), new_qty, 0, 0, 0.0))
        else:
            # A trade sweeps through 1-3 price levels on a random side, so
            # calibration sees genuine variance in |event_price - mid_price|
            # instead of every trade landing at the exact same best-level
            # distance (which fetch_regime_calibration cannot fit a slope to).
            side_is_buy_aggressor = rng.random() < 0.5
            flag = BUY_EVENT if side_is_buy_aggressor else SELL_EVENT
            mid_price = (price_at(-1) + price_at(1)) / 2.0
            remaining = float(rng.uniform(0.5, 5.0))

            for depth in range(1, int(rng.integers(1, 4)) + 1):
                offset = depth if side_is_buy_aggressor else -depth
                available = levels.get(offset, 0.0)
                if available <= 0.0 or remaining <= 0.0:
                    continue
                trade_qty = float(min(available, remaining))
                trade_price = price_at(offset)

                rows.append((TRADE_EVENT | flag | BOTH_SIDES, ts, ts, trade_price, trade_qty, 0, 0, 0.0))
                levels[offset] = max(0.0, available - trade_qty)
                rows.append((DEPTH_EVENT | flag | BOTH_SIDES, ts, ts, trade_price, levels[offset], 0, 0, 0.0))
                remaining -= trade_qty

                calibration_mid.append(mid_price)
                calibration_event_price.append(trade_price)
                calibration_event_time.append(ts / 1e9)

    replay_array = np.array(rows, dtype=EVENT_DTYPE)
    calibration = {
        "mid_price": np.asarray(calibration_mid, dtype=np.float64),
        "event_price": np.asarray(calibration_event_price, dtype=np.float64),
        "event_time": np.asarray(calibration_event_time, dtype=np.float64),
    }
    return replay_array, calibration


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a synthetic Alpha-Forge smoke-test dataset")
    parser.add_argument("--out-dir", type=Path, default=Path("."))
    parser.add_argument("--replay-filename", default="sample_replay.npz")
    parser.add_argument("--calibration-filename", default="sample_calibration.npz")
    parser.add_argument("--num-steps", type=int, default=20_000)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    replay_array, calibration = generate(num_steps=args.num_steps, seed=args.seed)

    replay_path = args.out_dir / args.replay_filename
    calibration_path = args.out_dir / args.calibration_filename

    np.savez(replay_path, data=replay_array)
    np.savez(calibration_path, **calibration)

    print(f"Wrote {len(replay_array)} replay events to {replay_path}")
    print(f"Wrote {len(calibration['event_time'])} calibration trade events to {calibration_path}")


if __name__ == "__main__":
    main()
