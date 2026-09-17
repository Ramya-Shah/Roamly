"""
Verifier for fix-backtest-bugs.

Checks two behavioral properties of /app/backtest_runner.py:

  Property A - Tick/lot detection
    _detect_tick_and_lot_size must return the actual minimum price and
    quantity increment observed in the dataset, not a hardcoded fallback.
    Verified with three synthetic datasets whose true increments are known
    in advance and differ from the 0.01/0.001 defaults, making a hardcoded
    or single-value special-case answer fail at least two of the three cases.

  Property B - NaN-safe order-book guard
    The replay must never emit NaN metrics on a valid dataset. This is
    verified on the real SUIUSDT dataset (which contains one-sided ticks
    where hftbacktest returns NaN for the missing side), AND by checking
    that two strategies with substantially different quoting parameters
    produce measurably different Sharpe ratios.

Anti-cheat notes
  - Property A uses three datasets with distinct known increments so that
    hardcoding any single answer (e.g. return 0.0001, 0.001) fails at
    least one case.
  - The two-strategy divergence test catches nan_to_num-style NaN fixes:
    NaN->0 for both strategies produces identical Sharpe (0 == 0), failing
    the inequality check.
  - fill_ratio must be nonzero: clamping NaN->0 leaves fill_ratio at 0
    because accounting is poisoned in the same loop.
"""

from __future__ import annotations

import importlib.util
import json
import math
import subprocess
import sys
import textwrap
from pathlib import Path

import numpy as np
import pytest

# paths
APP           = Path("/app")
RUNNER        = APP / "backtest_runner.py"
HIST          = APP / "historical_data"
SUIUSDT       = HIST / "suiusdt_real_replay.npz"
SAMPLE_REPLAY = HIST / "sample_replay.npz"


# helpers

def _make_npz(prices: np.ndarray, qtys: np.ndarray, path: Path) -> Path:
    """Write a minimal hftbacktest-format .npz with given px/qty series."""
    n = min(len(prices), len(qtys))
    dtype = np.dtype([
        ("ev",       np.int32),
        ("exch_ts",  np.int64),
        ("local_ts", np.int64),
        ("px",       np.float64),
        ("qty",      np.float64),
    ])
    data = np.zeros(n, dtype=dtype)
    data["ev"]  = 1
    data["px"]  = prices[:n]
    data["qty"] = qtys[:n]
    np.savez(path, data=data)
    return path


def _load_detect_fn():
    """Import _detect_tick_and_lot_size fresh from disk (no module caching)."""
    spec = importlib.util.spec_from_file_location("_br_fresh", RUNNER)
    mod  = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod._detect_tick_and_lot_size


def _write_strategy(path: Path, delta: float = 0.01) -> Path:
    code = textwrap.dedent(f"""\
        from strategy_templates import AvellanedaStoikovStrategy, RiskParameters

        class CustomStrategy(AvellanedaStoikovStrategy):
            def _reservation_and_spread(self, mid_price, inventory, t):
                return mid_price, {delta}, {delta}

        STRATEGY = CustomStrategy(
            RiskParameters(gamma=0.1, sigma=0.001, k=1.5, A=140.0,
                           T=3600.0, q_max=50.0, order_size=1.0)
        )
    """)
    path.write_text(code)
    return path


def _run(strategy: Path, dataset: Path, timeout: int = 120) -> dict:
    """Run backtest_runner.py as a subprocess; return the JSON metrics dict."""
    result = subprocess.run(
        [sys.executable, str(RUNNER),
         "--strategy-file", str(strategy),
         "--dataset",       str(dataset)],
        capture_output=True, text=True, timeout=timeout,
    )
    assert result.returncode == 0, (
        f"backtest_runner.py exited {result.returncode}.\n"
        f"stderr:\n{result.stderr[-2000:]}"
    )
    last_line = result.stdout.strip().splitlines()[-1]
    return json.loads(last_line)


# ── Property A: tick/lot detection ───────────────────────────────────────────

class TestTickDetection:
    """
    _detect_tick_and_lot_size must compute the minimum positive gap between
    distinct observed values in the dataset px and qty fields.
    Three datasets with different independently chosen increments are used
    so no single hardcoded answer can pass all cases.
    """

    CASES = [
        (0.0001, 0.001, "SUIUSDT-like fine-grained pricing"),
        (0.0025, 0.005, "mid-range increment pair"),
        (0.05,   0.1,   "coarser increment, different from the 0.01 default"),
    ]

    @pytest.mark.parametrize("expected_tick,expected_lot,desc", CASES)
    def test_detects_correct_increments(
        self, tmp_path, expected_tick, expected_lot, desc
    ):
        prices = np.arange(1.0, 1.0 + 200 * expected_tick, expected_tick)
        qtys   = np.arange(expected_lot, expected_lot * 201, expected_lot)
        npz    = _make_npz(prices, qtys, tmp_path / "data.npz")

        detect = _load_detect_fn()
        tick, lot = detect(npz)

        assert abs(tick - expected_tick) < expected_tick * 0.01, (
            f"[{desc}] Expected tick_size~{expected_tick}, got {tick:.8g}. "
            "_detect_tick_and_lot_size must derive the tick from the dataset "
            "px field, not return a hardcoded constant."
        )
        assert abs(lot - expected_lot) < expected_lot * 0.01, (
            f"[{desc}] Expected lot_size~{expected_lot}, got {lot:.8g}. "
            "_detect_tick_and_lot_size must derive the lot size from the "
            "dataset qty field, not return a hardcoded constant."
        )

    def test_hardcoded_default_not_returned_for_fine_grained_data(self, tmp_path):
        """Confirm the 0.01 default is not returned when data has finer ticks."""
        prices = np.arange(1.0000, 1.0200, 0.0001)
        qtys   = np.arange(0.001,  0.201,  0.001)
        npz    = _make_npz(prices, qtys, tmp_path / "data.npz")

        detect = _load_detect_fn()
        tick, _ = detect(npz)

        assert tick < 0.005, (
            f"Tick size returned ({tick}) is at or near the hardcoded fallback "
            "0.01. The function must read actual increments from px, not return "
            "a default."
        )


# ── Property B: NaN-safe guard and strategy distinguishability ────────────────

class TestNaNSafeGuard:
    """
    Verifies the NaN-safe guard and strategy distinguishability.

    test_no_nan_metrics_on_sample_dataset
        Runs a strategy on sample_replay.npz and asserts that every numeric
        metric is a finite float.

    test_distinct_strategies_produce_distinct_sharpe
        Runs two strategies with different custom spread deltas on sample_replay.npz
        and asserts their Sharpe ratios differ. With the tick-size bug present
        (0.01 hardcoded), fine-grained price differences collapse. With real tick
        detection, custom strategies produce distinct fills and distinct Sharpe.
    """

    @pytest.fixture(autouse=True)
    def require_dataset(self):
        if not SAMPLE_REPLAY.exists():
            pytest.skip(f"Sample dataset not found at {SAMPLE_REPLAY}")

    def test_no_nan_metrics_on_sample_dataset(self, tmp_path):
        strategy = _write_strategy(tmp_path / "s.py", delta=0.01)
        metrics  = _run(strategy, SAMPLE_REPLAY)

        nan_fields = [
            k for k, v in metrics.items()
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v))
        ]
        assert not nan_fields, (
            f"Output metrics contain NaN/Inf in: {nan_fields}. "
            "The order-book guard in _run_replay must use `not (x > 0)` "
            "instead of `x <= 0` so NaN bids/asks are skipped rather than "
            "propagated into mid_price and the equity curve."
        )

    def test_no_nan_metrics_on_suiusdt_dataset(self, tmp_path):
        if not SUIUSDT.exists():
            pytest.skip(f"Dataset not found at {SUIUSDT}")
        strategy = _write_strategy(tmp_path / "s_sui.py", delta=0.01)
        metrics  = _run(strategy, SUIUSDT)

        nan_fields = [
            k for k, v in metrics.items()
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v))
        ]
        assert not nan_fields, (
            f"Output metrics on SUIUSDT contain NaN/Inf in: {nan_fields}."
        )

    def test_distinct_strategies_produce_distinct_sharpe(self, tmp_path):
        s_tight = _write_strategy(tmp_path / "s_tight.py", delta=0.01)
        s_wide  = _write_strategy(tmp_path / "s_wide.py",  delta=0.05)

        m_tight = _run(s_tight, SAMPLE_REPLAY)
        m_wide  = _run(s_wide,  SAMPLE_REPLAY)

        sharpe_tight = m_tight["sharpe_ratio"]
        sharpe_wide  = m_wide["sharpe_ratio"]

        assert sharpe_tight != sharpe_wide, (
            f"Strategies with delta=0.01 and delta=0.05 returned identical "
            f"Sharpe ratios ({sharpe_tight}). Distinct quoting logic must "
            "produce distinct results."
        )

    def test_fill_ratio_is_nonzero_and_finite(self, tmp_path):
        strategy = _write_strategy(tmp_path / "s.py", delta=0.01)
        metrics  = _run(strategy, SAMPLE_REPLAY)

        fr = metrics["fill_ratio"]
        assert isinstance(fr, float) and math.isfinite(fr), (
            f"fill_ratio is {fr}, expected a finite float."
        )
        assert fr > 0.0, (
            f"fill_ratio is {fr}; the engine recorded zero fills on the dataset."
        )
