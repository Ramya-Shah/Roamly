"""
Verifier for debug-hft-backtest-engine.

Checks two behavioral properties of /app/backtest_runner.py:

  Property A — Tick/lot detection
    _detect_tick_and_lot_size must return the actual minimum price and
    quantity increment observed in the dataset, not a hardcoded fallback.
    Verified with three synthetic datasets whose true increments are known
    in advance and differ from the 0.01/0.001 defaults, making a hardcoded
    or single-value special-case answer fail at least two of the three cases.

  Property B — NaN-safe order-book guard
    The replay must never emit NaN metrics on a valid dataset.  This is
    verified on the real SUIUSDT dataset (which contains one-sided ticks
    where hftbacktest returns NaN for the missing side), AND by checking
    that two strategies with substantially different quoting parameters
    produce measurably different Sharpe ratios — a result that is impossible
    when all quotes collapse to the same coarse price grid.

Anti-cheat notes
  - Property A uses three datasets with distinct known increments so that
    hardcoding any single answer (e.g. `return 0.0001, 0.001`) fails at
    least one case.
  - Property B requires a nonzero fill_ratio on the real dataset so that
    clamping NaN→0 still leaves sharpe_ratio at 0 when fills occurred (a
    working fix would produce a nonzero Sharpe driven by the fills).
  - The two-strategy divergence test further catches nan_to_num-style fixes:
    NaN→0 for both strategies produces identical Sharpe (0 == 0), failing
    the inequality check.
"""

from __future__ import annotations

import importlib
import json
import math
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path

import numpy as np
import pytest

# ── paths ────────────────────────────────────────────────────────────────────
APP = Path("/app")
RUNNER = APP / "backtest_runner.py"
HIST = APP / "historical_data"
SUIUSDT = HIST / "suiusdt_real_replay.npz"

# ── helpers ───────────────────────────────────────────────────────────────────

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
    data["ev"]  = 1          # DEPTH_EVENT — price/qty rows
    data["px"]  = prices[:n]
    data["qty"] = qtys[:n]
    np.savez(path, data=data)
    return path


def _load_detect_fn():
    """Import _detect_tick_and_lot_size fresh (bypasses any cached module)."""
    spec = importlib.util.spec_from_file_location("_br_fresh", RUNNER)
    mod  = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod._detect_tick_and_lot_size


def _write_strategy(path: Path, gamma: float) -> Path:
    code = textwrap.dedent(f"""\
        from strategy_templates import AvellanedaStoikovStrategy, RiskParameters
        STRATEGY = AvellanedaStoikovStrategy(
            RiskParameters(gamma={gamma}, sigma=0.001, k=1.5, A=140.0,
                           T=3600.0, q_max=50.0)
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


# ═══════════════════════════════════════════════════════════════════════════════
# Property A — tick/lot detection returns true increments, not hardcoded values
# ═══════════════════════════════════════════════════════════════════════════════

class TestTickDetection:
    """
    _detect_tick_and_lot_size must compute the minimum positive gap between
    distinct observed values in the dataset's 'px' and 'qty' fields.
    Three datasets with different, independently chosen increments are used
    so no single hardcoded answer can pass all cases.
    """

    CASES = [
        # (tick,   lot,    description)
        (0.0001, 0.001,  "SUIUSDT-like fine-grained pricing"),
        (0.0025, 0.005,  "mid-range increment pair"),
        (0.05,   0.1,    "coarser increment — different from the 0.01 default"),
    ]

    @pytest.mark.parametrize("expected_tick,expected_lot,desc", CASES)
    def test_detects_correct_increments(
        self, tmp_path, expected_tick, expected_lot, desc
    ):
        # Build a dataset whose observed price grid is exactly expected_tick
        # and quantity grid is exactly expected_lot.
        prices = np.arange(1.0, 1.0 + 200 * expected_tick, expected_tick)
        qtys   = np.arange(expected_lot, expected_lot * 201, expected_lot)
        npz    = _make_npz(prices, qtys, tmp_path / "data.npz")

        detect = _load_detect_fn()
        tick, lot = detect(npz)

        assert abs(tick - expected_tick) < expected_tick * 0.01, (
            f"[{desc}] Expected tick_size≈{expected_tick}, got {tick:.8g}. "
            "_detect_tick_and_lot_size must derive the tick from the dataset's "
            "'px' field, not return a hardcoded constant."
        )
        assert abs(lot - expected_lot) < expected_lot * 0.01, (
            f"[{desc}] Expected lot_size≈{expected_lot}, got {lot:.8g}. "
            "_detect_tick_and_lot_size must derive the lot size from the "
            "dataset's 'qty' field, not return a hardcoded constant."
        )

    def test_hardcoded_default_not_returned_for_fine_grained_data(self, tmp_path):
        """Confirm the 0.01 default is not returned when data has finer ticks."""
        prices = np.arange(1.0000, 1.0200, 0.0001)  # 200 ticks at 0.0001
        qtys   = np.arange(0.001,  0.201,  0.001)
        npz    = _make_npz(prices, qtys, tmp_path / "data.npz")

        detect = _load_detect_fn()
        tick, _ = detect(npz)

        assert tick < 0.005, (
            f"Tick size returned ({tick}) is close to the hardcoded fallback 0.01. "
            "The function must read actual increments from 'px', not return a default."
        )


# ═══════════════════════════════════════════════════════════════════════════════
# Property B — NaN-safe guard: no NaN metrics, distinct strategies differ
# ═══════════════════════════════════════════════════════════════════════════════

class TestNaNSafeGuard:
    """
    Two tests verify the NaN-safe guard from complementary angles:

    test_no_nan_metrics_on_real_dataset
        Runs a single strategy on the real SUIUSDT dataset and asserts that
        every numeric metric is a finite (non-NaN, non-inf) float.  The real
        dataset contains ticks where one side of the book is absent, producing
        NaN from hftbacktest's depth.best_bid / depth.best_ask; the guard must
        skip those ticks rather than propagate NaN through the equity curve.

    test_distinct_strategies_produce_distinct_sharpe
        Runs two strategies with very different gamma values on the same real
        dataset and asserts their Sharpe ratios differ.  With the tick-size bug
        present (0.01 default on a 0.0001-increment asset), all quoted prices
        collapse to the same few levels so both strategies produce identical
        fills — and identical Sharpe.  This test therefore catches the tick-size
        bug even without running the unit-level tick detection test, and it also
        catches a nan_to_num-style NaN fix: 0 == 0 would fail the inequality.
    """

    @pytest.fixture(autouse=True)
    def require_suiusdt(self):
        if not SUIUSDT.exists():
            pytest.skip(f"Real dataset not found at {SUIUSDT}")

    def test_no_nan_metrics_on_real_dataset(self, tmp_path):
        strategy = _write_strategy(tmp_path / "s.py", gamma=0.1)
        metrics  = _run(strategy, SUIUSDT)

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

    def test_distinct_strategies_produce_distinct_sharpe(self, tmp_path):
        # gamma=0.01 → very narrow spreads, aggressive quoting
        # gamma=5.0  → very wide spreads, conservative quoting
        # These should produce meaningfully different fill profiles and Sharpe.
        s_aggressive   = _write_strategy(tmp_path / "s_agg.py",  gamma=0.01)
        s_conservative = _write_strategy(tmp_path / "s_cons.py", gamma=5.0)

        m_agg  = _run(s_aggressive,   SUIUSDT)
        m_cons = _run(s_conservative, SUIUSDT)

        sharpe_agg  = m_agg["sharpe_ratio"]
        sharpe_cons = m_cons["sharpe_ratio"]

        assert sharpe_agg != sharpe_cons, (
            f"Strategies with gamma=0.01 and gamma=5.0 returned identical "
            f"Sharpe ratios ({sharpe_agg}). Distinct quoting logic must "
            "produce distinct results. This happens when all quoted prices are "
            "rounded to the same coarse grid because _detect_tick_and_lot_size "
            "returns the hardcoded 0.01 default instead of the real 0.0001 "
            "increment of the SUIUSDT dataset."
        )

    def test_fill_ratio_is_nonzero_and_finite(self, tmp_path):
        """A working engine must record actual fills on the SUIUSDT dataset.

        If the entire equity curve is NaN (from the guard bug) and then
        clamped to 0 by nan_to_num, fill_ratio stays 0 because accounting
        is done inside the same loop that is poisoned by NaN propagation.
        A genuine fix restores finite fill accounting.
        """
        strategy = _write_strategy(tmp_path / "s.py", gamma=0.1)
        metrics  = _run(strategy, SUIUSDT)

        fr = metrics["fill_ratio"]
        assert isinstance(fr, float) and math.isfinite(fr), (
            f"fill_ratio is {fr}, expected a finite float."
        )
        assert fr > 0.0, (
            f"fill_ratio is {fr}; the engine recorded zero fills on the "
            "SUIUSDT dataset. A working engine must register at least some "
            "fills during a 60-minute replay of real market data."
        )
