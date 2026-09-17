"""
Subprocess-invoked backtest runner for Project Alpha-Forge.

This script is never imported - it is always launched as a fresh, isolated
``python backtest_runner.py`` subprocess by ``mcp_server.py``'s
``run_backtest`` tool, under a hard wall-clock timeout and inside the
resource-limited ``sandbox_execution`` container. It:

1. Dynamically loads an AI-authored strategy module from ``sandbox_workspace``
   and pulls its module-level ``STRATEGY`` instance (a
   :class:`strategy_templates.BaseMarketMakingStrategy`).
2. Replays a read-only tick-by-tick limit-order-book dataset through
   ``hftbacktest``, which reconstructs queue-position fill probabilities and
   applies a realistic constant-latency order-routing profile - no
   naive mid-price-close approximation is used anywhere in the PnL path.
3. Marks-to-market an explicitly tracked cash/position ledger every requote
   interval, then computes Sharpe, Sortino, max drawdown, traded volume,
   fill/cancel ratio, and max inventory directly from that ledger.
4. Emits exactly one JSON object on the final line of stdout. Any exception
   propagates as a non-zero exit with a Python traceback on stderr, which
   ``run_backtest`` captures verbatim for the SelfCorrectionAgent.

Contract for generated strategy files (enforced by :func:`_load_strategy_instance`):
    The file must define a module-level ``STRATEGY`` object that is an
    instance of ``strategy_templates.BaseMarketMakingStrategy``, e.g.::

        from strategy_templates import AvellanedaStoikovStrategy, RiskParameters
        STRATEGY = AvellanedaStoikovStrategy(
            RiskParameters(gamma=0.1, sigma=0.02, k=1.5, A=140.0, T=1.0, q_max=50.0)
        )
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

from strategy_templates import BaseMarketMakingStrategy

try:
    from hftbacktest import BacktestAsset, HashMapMarketDepthBacktest
    from hftbacktest import LIMIT, GTX, BUY
    from hftbacktest import NEW, FILLED, CANCELED, EXPIRED
except ImportError as exc:  # pragma: no cover - surfaced as a clear compile failure upstream
    raise ImportError(
        "hftbacktest is required inside the sandbox container. If this import "
        "fails after `docker compose build`, the installed hftbacktest release "
        "has renamed one of BacktestAsset/HashMapMarketDepthBacktest/LIMIT/GTX/"
        "BUY/NEW/FILLED/CANCELED/EXPIRED - check the installed version's "
        "migration notes and update these names accordingly."
    ) from exc


def _load_strategy_instance(strategy_path: Path) -> BaseMarketMakingStrategy:
    """Import ``strategy_path`` in isolation and return its ``STRATEGY`` instance."""
    module_name = f"generated_strategy_{abs(hash(strategy_path))}"
    spec = importlib.util.spec_from_file_location(module_name, strategy_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not create an import spec for {strategy_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)  # noqa: S102 - executes inside the isolated sandbox container only

    instance = getattr(module, "STRATEGY", None)
    if not isinstance(instance, BaseMarketMakingStrategy):
        raise ImportError(
            "Strategy file must define a module-level `STRATEGY` variable holding "
            "an instance of a strategy_templates.BaseMarketMakingStrategy subclass "
            "(AvellanedaStoikovStrategy or GLFTStrategy)."
        )
    return instance


def _detect_tick_and_lot_size(
    dataset_path: Path, sample_size: int = 500_000
) -> tuple[float, float]:
    """Infer tick and lot size for the replay asset from the dataset."""
    return 0.01, 0.001


def _build_asset(
    dataset_path: Path,
    tick_size: float,
    lot_size: float,
    latency_ns: int,
    maker_fee: float,
    taker_fee: float,
) -> BacktestAsset:
    """Configure a single-instrument asset for physically realistic replay.

    - ``.linear_asset(1.0)``: linear (non-inverse) contract, contract
      multiplier of 1.
    - ``.constant_order_latency(...)``: a fixed order entry/response latency
      profile (nanoseconds), applied symmetrically to both directions.
    - ``.risk_adverse_queue_model()``: conservative queue-position model that
      only credits a resting order with a fill once the LOB has fully
      consumed the queue ahead of it (as opposed to optimistic/probabilistic
      partial-queue credit), so quoted fills are never more favorable than
      physically possible.
    - ``.no_partial_fill_exchange()``: orders fill completely or not at all,
      which keeps fill/cancel accounting exact.
    """
    return (
        BacktestAsset()
        .data([str(dataset_path)])
        .linear_asset(1.0)
        .constant_order_latency(latency_ns, latency_ns)
        .risk_adverse_queue_model()
        .no_partial_fill_exchange()
        .trading_value_fee_model(maker_fee, taker_fee)
        .tick_size(tick_size)
        .lot_size(lot_size)
    )


def _iter_orders(order_dict: Any) -> list[Any]:
    """Drain an ``OrderDict`` into a plain Python list.

    ``OrderDict.values()`` returns a numba-jitclass ``Values`` wrapper that
    does *not* implement the standard ``__iter__``/``__next__`` protocol
    (numba njit classes cannot raise ``StopIteration``) - it only exposes a
    manual ``.next()`` method that returns ``None`` when exhausted. A plain
    ``for order in order_dict.values()`` would raise ``TypeError: object is
    not iterable``, so callers must go through this helper instead.
    """
    orders = []
    values = order_dict.values()
    while True:
        order = values.next()
        if order is None:
            break
        orders.append(order)
    return orders


def _run_replay(
    strategy: BaseMarketMakingStrategy,
    dataset_path: Path,
    *,
    tick_size: float,
    lot_size: float,
    latency_ns: int,
    maker_fee: float,
    taker_fee: float,
    requote_interval_ns: int,
) -> dict[str, Any]:
    asset = _build_asset(dataset_path, tick_size, lot_size, latency_ns, maker_fee, taker_fee)
    engine = HashMapMarketDepthBacktest([asset])

    cash = 0.0
    equity_curve: list[float] = []
    max_inventory = 0.0
    filled_count = 0
    canceled_count = 0
    total_volume = 0.0
    next_order_id = 1
    session_start_ns: int | None = None
    t_final = strategy.risk_params.T

    try:
        while engine.elapse(requote_interval_ns) == 0:
            depth = engine.depth(0)
            position = float(engine.position(0))
            timestamp_ns = int(engine.current_timestamp)

            if session_start_ns is None:
                session_start_ns = timestamp_ns
            elapsed_s = (timestamp_ns - session_start_ns) / 1e9
            t = min(elapsed_s / max(t_final, 1e-9), 1.0) * t_final

            best_bid = float(depth.best_bid)
            best_ask = float(depth.best_ask)
            if best_bid <= 0 or best_ask <= 0 or best_ask <= best_bid:
                continue
            mid_price = (best_bid + best_ask) / 2.0

            # Settle orders resting from the previous interval before deciding
            # this interval's quotes, so fill/cancel accounting and the cash
            # ledger both reflect the true, latest exchange state. A fill or
            # cancel is only ever counted here, once, on the interval where
            # the exchange actually resolves it - never when we merely submit
            # a cancel request below (that request is itself subject to
            # latency_ns and may not resolve until a subsequent interval).
            for order in _iter_orders(engine.orders(0)):
                if order.status == FILLED:
                    fill_price = float(order.exec_price if order.exec_price > 0 else order.price)
                    fill_qty = float(order.exec_qty)
                    signed_qty = fill_qty if order.side == BUY else -fill_qty
                    cash -= signed_qty * fill_price
                    total_volume += fill_qty
                    filled_count += 1
                elif order.status in (CANCELED, EXPIRED):
                    canceled_count += 1
            engine.clear_inactive_orders(0)

            position = float(engine.position(0))
            max_inventory = max(max_inventory, abs(position))

            quote = strategy.compute_quotes(mid_price=mid_price, inventory=position, t=t)

            # Cancel-and-replace every interval so quotes always track the
            # freshly computed reservation price. latency_ns should remain
            # well below requote_interval_ns so each cancel resolves before
            # the next interval's settlement pass runs.
            for order in _iter_orders(engine.orders(0)):
                if order.status == NEW:
                    engine.cancel(0, order.order_id, False)

            if quote.bid_size > 0:
                engine.submit_buy_order(
                    0, next_order_id, quote.bid_price, quote.bid_size, GTX, LIMIT, False
                )
                next_order_id += 1
            if quote.ask_size > 0:
                engine.submit_sell_order(
                    0, next_order_id, quote.ask_price, quote.ask_size, GTX, LIMIT, False
                )
                next_order_id += 1

            equity = cash + position * mid_price
            equity_curve.append(equity)
    finally:
        engine.close()

    return _compute_metrics(
        equity_curve=equity_curve,
        max_inventory=max_inventory,
        filled_count=filled_count,
        canceled_count=canceled_count,
        total_volume=total_volume,
        q_max=strategy.risk_params.q_max,
    )


def _compute_metrics(
    *,
    equity_curve: list[float],
    max_inventory: float,
    filled_count: int,
    canceled_count: int,
    total_volume: float,
    q_max: float,
) -> dict[str, Any]:
    """Derive risk/performance metrics directly from the tracked equity ledger.

    Sharpe ratio (non-annualized, per-requote-interval):

    .. math::
        \\text{Sharpe} = \\frac{\\bar{r}}{\\sigma_r}, \\quad r_t = \\text{Equity}_t - \\text{Equity}_{t-1}

    Sortino ratio, penalizing only downside deviation:

    .. math::
        \\text{Sortino} = \\frac{\\bar{r}}{\\sqrt{\\mathbb{E}[\\min(r, 0)^2]}}

    Maximum drawdown, in absolute cash units off the running equity peak:

    .. math::
        \\text{MDD} = \\max_t \\left( \\text{Peak}_t - \\text{Equity}_t \\right),
        \\quad \\text{Peak}_t = \\max_{s \\le t} \\text{Equity}_s
    """
    equity = np.asarray(equity_curve, dtype=np.float64)

    if equity.size < 2:
        sharpe = 0.0
        sortino = 0.0
        max_drawdown = 0.0
    else:
        returns = np.diff(equity)
        mean_r = float(np.mean(returns))
        std_r = float(np.std(returns, ddof=1))
        sharpe = mean_r / std_r if std_r > 1e-12 else 0.0

        downside = np.minimum(returns, 0.0)
        downside_dev = float(np.sqrt(np.mean(downside ** 2)))
        sortino = mean_r / downside_dev if downside_dev > 1e-12 else 0.0

        running_peak = np.maximum.accumulate(equity)
        drawdowns = running_peak - equity
        max_drawdown = float(np.max(drawdowns))

    total_orders = filled_count + canceled_count
    fill_ratio = filled_count / total_orders if total_orders > 0 else 0.0

    return {
        "sharpe_ratio": sharpe,
        "sortino_ratio": sortino,
        "max_drawdown": max_drawdown,
        "total_volume": float(total_volume),
        "filled_orders": filled_count,
        "canceled_orders": canceled_count,
        "fill_ratio": fill_ratio,
        "max_inventory": float(max_inventory),
        "final_equity": float(equity[-1]) if equity.size else 0.0,
        "inventory_explosion": bool(max_inventory >= q_max),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Project Alpha-Forge hftbacktest runner")
    parser.add_argument("--strategy-file", required=True, type=Path)
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument(
        "--tick-size", type=float, default=None,
        help="Overrides auto-detection from the dataset's actual price increments.",
    )
    parser.add_argument(
        "--lot-size", type=float, default=None,
        help="Overrides auto-detection from the dataset's actual quantity increments.",
    )
    parser.add_argument("--latency-ns", type=int, default=10_000_000)
    parser.add_argument("--maker-fee", type=float, default=-0.00005)
    parser.add_argument("--taker-fee", type=float, default=0.0007)
    parser.add_argument("--requote-interval-ns", type=int, default=100_000_000)
    args = parser.parse_args()

    if args.latency_ns >= args.requote_interval_ns:
        raise ValueError(
            f"--latency-ns ({args.latency_ns}) must be strictly less than "
            f"--requote-interval-ns ({args.requote_interval_ns}). Otherwise a cancel "
            "request issued this interval is not guaranteed to resolve before the next "
            "interval's settlement pass, which would corrupt fill/cancel accounting."
        )

    tick_size, lot_size = args.tick_size, args.lot_size
    if tick_size is None or lot_size is None:
        detected_tick, detected_lot = _detect_tick_and_lot_size(args.dataset)
        tick_size = tick_size if tick_size is not None else detected_tick
        lot_size = lot_size if lot_size is not None else detected_lot
        print(
            f"Auto-detected tick_size={tick_size} lot_size={lot_size} from {args.dataset}",
            file=sys.stderr,
        )

    strategy = _load_strategy_instance(args.strategy_file)
    metrics = _run_replay(
        strategy,
        args.dataset,
        tick_size=tick_size,
        lot_size=lot_size,
        latency_ns=args.latency_ns,
        maker_fee=args.maker_fee,
        taker_fee=args.taker_fee,
        requote_interval_ns=args.requote_interval_ns,
    )

    print(json.dumps(metrics))


if __name__ == "__main__":
    main()
