# Debug the Alpha-Forge Backtest Engine

The Alpha-Forge project (`/app`) is an offline, AI-driven HFT strategy
generation sandbox. A backtest engine in `/app/backtest_runner.py` replays
historical limit-order-book data through a physically realistic matching engine
and computes performance metrics — Sharpe ratio, fill ratio, max drawdown, and
others — for any strategy passed to it.

Two bugs have been reported against the engine. First: when two strategies with
meaningfully different quoting logic are backtested against the SUIUSDT dataset
at `/app/historical_data/suiusdt_real_replay.npz`, they return identical Sharpe
ratios, identical fill counts, and identical equity curves — as if the engine
cannot tell them apart. This is reproducible across strategy pairs and across
multiple runs. Second: on certain inputs, every numeric metric in the output —
Sharpe, Sortino, drawdown, final equity — is `NaN`, with no exception raised
and no error message printed. The backtest exits with code 0 and emits a valid
JSON object, making the corruption invisible to the caller.

Both bugs are in `/app/backtest_runner.py`. Reproduce each symptom, locate the
root cause, and fix the code so that distinct strategies produce distinct
measurable results on the SUIUSDT dataset, and so that the engine never emits
`NaN` metrics under any valid input. The test suite at `/app/tests/` verifies
both properties with controlled synthetic data and must pass in full.
