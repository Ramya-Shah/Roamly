#!/usr/bin/env bash
# Oracle solution for debug-hft-backtest-engine.
#
# Applies both bug fixes to /app/backtest_runner.py in-place:
#   Fix 1 — _detect_tick_and_lot_size: compute minimum positive increment from
#            the dataset's actual px/qty fields instead of returning hardcoded
#            defaults (0.01, 0.001).
#   Fix 2 — _run_replay order-book guard: replace the NaN-unsafe `x <= 0`
#            comparisons with the IEEE-754-safe `not (x > 0)` form so that a
#            momentarily one-sided order book (NaN bid or ask) is skipped
#            rather than silently poisoning the equity curve.

set -euo pipefail

python3 - <<'PYEOF'
from pathlib import Path

src = Path("/app/backtest_runner.py").read_text()

# ── Fix 1: restore real tick/lot detection ────────────────────────────────────
OLD_STUB = '''\
def _detect_tick_and_lot_size(
    dataset_path: Path, sample_size: int = 500_000
) -> tuple[float, float]:
    """Infer tick and lot size for the replay asset from the dataset."""
    return 0.01, 0.001'''

NEW_DETECT = '''\
def _min_positive_increment(values, fallback: float) -> float:
    """Smallest positive gap between distinct positive values in *values*.

    Gaps smaller than 1e-12 are treated as float-noise copies of the same
    level and discarded, so the result reflects a genuine price/qty grid step
    rather than floating-point rounding artefacts.
    """
    positive = values[values > 0]
    if positive.size < 2:
        return fallback
    unique_sorted = np.unique(positive)
    if unique_sorted.size < 2:
        return fallback
    diffs = np.diff(unique_sorted)
    diffs = diffs[diffs > 1e-12]
    if diffs.size == 0:
        return fallback
    return float(np.round(np.min(diffs), 10))


def _detect_tick_and_lot_size(
    dataset_path: Path, sample_size: int = 500_000
) -> tuple[float, float]:
    """Infer tick and lot size for the replay asset from the dataset."""
    with np.load(dataset_path) as npz:
        data = npz["data"][:sample_size]
    tick_size = _min_positive_increment(data["px"], fallback=0.01)
    lot_size  = _min_positive_increment(data["qty"], fallback=0.001)
    return tick_size, lot_size'''

assert OLD_STUB in src, (
    "Could not locate the stub body of _detect_tick_and_lot_size. "
    "The file may already be patched or has been edited unexpectedly."
)
src = src.replace(OLD_STUB, NEW_DETECT, 1)

# ── Fix 2: NaN-safe order-book guard ─────────────────────────────────────────
OLD_GUARD = "if best_bid <= 0 or best_ask <= 0 or best_ask <= best_bid:"
NEW_GUARD = "if not (best_bid > 0) or not (best_ask > 0) or not (best_ask > best_bid):"

assert OLD_GUARD in src, (
    "Could not locate the NaN-unsafe guard in _run_replay. "
    "The file may already be patched or has been edited unexpectedly."
)
src = src.replace(OLD_GUARD, NEW_GUARD, 1)

Path("/app/backtest_runner.py").write_text(src)
print("Fix 1 applied: _detect_tick_and_lot_size now reads true increments from data.")
print("Fix 2 applied: order-book guard now uses NaN-safe `not (x > 0)` form.")
PYEOF
