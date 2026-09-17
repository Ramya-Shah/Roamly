# Debug the Alpha-Forge Backtest Engine

The Alpha-Forge project (`/app`) is an offline, AI-driven HFT strategy
generation sandbox. A backtest engine in `/app/backtest_runner.py` replays
historical limit-order-book data through a physically realistic matching engine
and computes performance metrics — Sharpe ratio, fill ratio, max drawdown, and
others — for any strategy passed to it.

Two bugs have been reported against the engine:

1. **Strategy Collapsing & Increment Misdetection**: When strategies with
   meaningfully different quoting parameters are backtested against datasets
   in `/app/historical_data/` (such as `suiusdt_real_replay.npz` or `sample_replay.npz`),
   they return identical Sharpe ratios and fill counts as if the engine cannot
   tell them apart. This occurs because the engine fails to infer the actual tick
   and lot size increments from the dataset's price and quantity fields,
   collapsing distinct quoted prices onto a coarse grid. The engine must
   automatically detect and use the true minimum price and quantity increments
   from any dataset passed to it.

2. **Silent `NaN` Metric Corruption**: On certain inputs or temporary market
   disruptions (such as a one-sided order book), every numeric metric in the
   output — Sharpe, Sortino, drawdown, final equity — is evaluated as `NaN`, with
   no exception raised and exit code 0. The order-book guard must safely handle
   missing/invalid bid and ask prices so that invalid ticks are skipped and no
   `NaN` metrics are emitted.

Both bugs are in `/app/backtest_runner.py`. Reproduce each symptom, locate the
root causes, and fix the code so that distinct strategies produce distinct
measurable results, dataset price/lot increments are accurately inferred from
data, and the engine never emits `NaN` metrics under any valid input. The test
suite at `/app/tests/` verifies both properties with controlled datasets and
must pass in full.

