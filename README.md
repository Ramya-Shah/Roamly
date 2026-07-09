# Project Alpha-Forge

**An offline, AI-driven HFT strategy generation, calibration, and backtesting sandbox — a
"Generative Quant Desk."**

An LLM writes market-making strategies. A static risk audit vets them before they ever run. A
physically-realistic limit-order-book engine scores them against real historical exchange data —
no naive mid-price approximations. A self-correction loop feeds every result back so each attempt
learns from the last, is forced to try something *genuinely* different when it fails, and is
validated on data it never saw before it's allowed to call itself a success.

---

## Table of contents

1. [Why this exists](#why-this-exists)
2. [Architecture](#architecture)
3. [The agent loop](#the-agent-loop)
4. [The math](#the-math)
5. [Data: synthetic and real](#data-synthetic-and-real)
6. [Calibration](#calibration)
7. [The backtest engine](#the-backtest-engine)
8. [Making the loop actually improve](#making-the-loop-actually-improve)
9. [The dashboard](#the-dashboard)
10. [Security and sandboxing](#security-and-sandboxing)
11. [Project layout](#project-layout)
12. [Configuration reference](#configuration-reference)
13. [Running it](#running-it)
14. [Notable bugs found along the way](#notable-bugs-found-along-the-way)
15. [Known limitations](#known-limitations)

---

## Why this exists

Generative AI models introduce substantial network latency — they cannot be a live, real-time
signal generator sitting on a matching engine. So this project doesn't try to make them one.
Instead, the LLM operates entirely **offline**, as a strategy *author*: it writes Python code once
per attempt, that code gets compiled and replayed against history, and the LLM sees the result and
tries again. The generative step and the execution step are fully decoupled, and only one of them
ever touches anything resembling "the market" (a historical replay, never a live one).

Everything downstream of that one design decision follows from it:

- Because the LLM's output is untrusted code, it runs in an **isolated sandbox** with no filesystem
  access beyond one scratch directory, no network, and a hard execution timeout.
- Because a backtest number in isolation is easy to game (or accidentally overfit), every claimed
  win is checked against a **held-out window it was never scored against**.
- Because "try again" is cheap for an LLM and expensive for a human reviewing the output, the system
  tracks *what's already been tried* and forces genuine diversity rather than cosmetic retries.

## Architecture

Four logical services, orchestrated either as separate Docker Compose containers (development) or
consolidated into one image (deployment):

```
                    ┌─────────────────────────────────────────────┐
                    │              dashboard_ui (nginx)             │
                    │   serves the React SPA, proxies /api/ ↓       │
                    └─────────────────────────┬─────────────────────┘
                                              │
                    ┌─────────────────────────▼─────────────────────┐
                    │         dashboard_api (FastAPI + uvicorn)       │
                    │  LangGraph pipeline · SSE streaming · DuckDB    │
                    │  memory · calls out to the LLM gateway          │
                    └─────────────────────────┬─────────────────────┘
                                              │ MCP over SSE
                    ┌─────────────────────────▼─────────────────────┐
                    │           sandbox_execution (FastMCP)           │
                    │  write_strategy_code · run_backtest ·           │
                    │  fetch_regime_calibration                       │
                    │  — the ONLY thing that ever runs AI-written     │
                    │    code, in a resource-capped container         │
                    └─────────────────────────────────────────────────┘
```

The orchestrator container never touches strategy code or historical data directly — it only calls
three tools over the network. The sandbox container never talks to an LLM or the internet — it only
executes what it's told, against data it was given ahead of time.

| Service | File(s) | Role |
|---|---|---|
| `sandbox_execution` | `mcp_server.py`, `backtest_runner.py`, `strategy_templates.py` | FastMCP/SSE tool server; the sandbox boundary |
| `dashboard_api` | `api_server.py`, `orchestrator.py`, `memory_manager.py` | FastAPI backend; runs the LangGraph pipeline; SSE streaming to the browser |
| `dashboard_ui` | `frontend/` | React SPA: trigger runs, watch live progress, browse history, view generated code |
| `orchestrator` (CLI) | `orchestrator.py` | One-shot CLI entry point for the same pipeline, no dashboard needed |

## The agent loop

The pipeline is a cyclic **LangGraph** state machine with four nodes:

```
synthesis ──► risk_audit ──(rejected, retries left)──► synthesis
                    │
              (passed)
                    ▼
               execution ──► self_correction ──(retry)──► synthesis
                                     │
                              (success / budget exhausted)
                                     ▼
                                    END
```

**StrategySynthesisAgent** — calls the LLM (`gpt-5.5` by default) with the calibrated market
constants, the best historically-successful approaches for this exact dataset (seeded from
persistent memory), and — on a retry — an explicit instruction that this attempt must be
**materially different** from every approach already tried this run, not a cosmetic rename.

**RiskAuditAgent** — a static AST scan, *before any code executes*, that rejects:
- forbidden imports (`os`, `subprocess`, `socket`, `requests`, …) and dangerous calls (`eval`,
  `exec`, `open`, dunder introspection like `__subclasses__`);
- any override of `compute_quotes` itself (which carries the mandatory inventory-safety clamp —
  only the intended extension point, `_reservation_and_spread`, may be overridden);
- a missing `STRATEGY = ...` assignment or missing return contract (three-tuple: reservation price,
  bid delta, ask delta);
- **placeholder stub methods** — a helper whose entire body is `return 0.0` (a real failure mode
  observed live: the model invents a plausible-sounding signal like
  `get_trade_flow_imbalance()`, stubs it out, and the "new approach" becomes a byte-identical
  no-op of the baseline while still claiming to be something new).

Note what's *not* on this list: lookahead bias into future data isn't just discouraged, it's
**structurally impossible** — the strategy interface only ever receives the current tick's
`(mid_price, inventory, t)`, never a data array to peek ahead into.

**ExecutionAgent** — dispatches the written file to the sandbox's `run_backtest` tool, which
launches `backtest_runner.py` as a subprocess with a hard wall-clock timeout
(`BACKTEST_TIMEOUT_SECONDS`, default 120s) enforced via process-group kill.

**SelfCorrectionAgent** — the feedback router:
- **Timeout** → told to simplify (`_reservation_and_spread` must be O(1) per call).
- **Crash** → fed the raw traceback, told to fix the bug *keeping the same approach* (this is
  debugging, not a strategy change).
- **Inventory explosion** → gamma is forcibly escalated (`×1.5`, capped) and the run retries with
  the same approach, more conservative.
- **Underperformed the benchmark** → fed full diagnostics (fill ratio, cancels, drawdown), not just
  a bare Sharpe number, plus an explicit "you must now use a different approach" instruction and the
  list of everything already tried.
- **Beat the benchmark in-sample** → validated against a held-out window before being allowed to
  succeed (see [below](#making-the-loop-actually-improve)).

## The math

Every generated strategy subclasses one of two closed-form baselines from
`strategy_templates.py`.

**Avellaneda-Stoikov** (finite-horizon inventory model):

Reservation price — shifts away from mid-price opposite the current inventory:

$$r(s, q, t) = s - q\,\gamma\,\sigma^2\,(T - t)$$

Symmetric optimal spread — widens with remaining horizon, volatility, and risk-aversion:

$$\delta_b(q) + \delta_a(q) = \gamma\sigma^2(T-t) + \frac{2}{\gamma}\ln\!\left(1 + \frac{\gamma}{k}\right)$$

**GLFT** (Guéant–Lehalle–Fernandez-Tapia linear-skew approximation, for an undefined/rolling
horizon):

$$\delta_b(q) = C_1 + \frac{\sigma C_2}{2} + \sigma C_2\, q, \qquad
\delta_a(q) = C_1 + \frac{\sigma C_2}{2} - \sigma C_2\, q$$

$$C_1 = \frac{1}{\gamma}\ln\!\left(1+\frac{\gamma}{k}\right), \qquad
C_2 = \sqrt{\frac{\gamma}{2Ak}}$$

Where $\gamma$ is risk-aversion, $\sigma$ is price volatility, $k$ and $A$ are order-arrival
liquidity constants fit from real data (see [Calibration](#calibration)), and $q_{max}$ bounds
inventory — the base class clamps resting size toward zero on whichever side would push inventory
past it, regardless of what an override computes.

## Data: synthetic and real

**`generate_sample_data.py`** — a synthetic random-walk limit order book, for a dependency-free
smoke test with no network access needed. Clearly documented as synthetic; not for drawing real
conclusions.

**`fetch_real_data.py`** — downloads genuine, free, public Bybit historical data (no API key):
full L2 order-book depth (`quote-saver.bycsi.com`, up to 500 price levels) and trades
(`public.bybit.com`), discovered via Bybit's own file-listing API, converted with **hftbacktest's
own official `bybithistmktdata` converter** — not a hand-rolled approximation. Full-day files run
30–300+ MB (too large to replay inside the sandbox's timeout even for a correct strategy), so the
script truncates to a bounded window while reconstructing a genuine mid-price series from the real
order book, paired with real trades, for calibration.

The shipped dataset: **SUIUSDT**, chosen from a handful of candidates purely because it had the
smallest daily file size among them (no analysis of the asset itself) — a 60-minute training window
(2024-06-01) plus a held-out out-of-sample window from the **next day** (2024-06-02).

## Calibration

`fetch_regime_calibration` fits order-arrival intensity from real trade data:

$$\ln \lambda(\delta) = -k\delta + \ln A$$

via a Numba-JIT-compiled OLS closed-form solve (not a library call — a hand-written normal-equations
loop that actually compiles under `@njit`). Realized volatility $\sigma$ is computed from the same
real mid-price series (sum of squared absolute price changes over the observation window, matching
the arithmetic-Brownian-motion convention the strategies themselves use — not log-returns).

This regime classification (`low`/`medium`/`high`/`extreme`, bucketed on $\sigma$) is what
`memory_manager.py` uses to bucket historical constant-seeding — separately from benchmark
comparisons, which are keyed by the exact dataset, not the coarse bucket (see
[bugs found](#notable-bugs-found-along-the-way)).

## The backtest engine

`backtest_runner.py` drives `hftbacktest` — a real matching engine, not a mid-price approximation:

- `.risk_adverse_queue_model()` — a resting order only credits a fill once the book has genuinely
  consumed the queue ahead of it.
- `.constant_order_latency(...)` — a real order entry/response latency profile.
- `.no_partial_fill_exchange()` — fills are all-or-nothing, keeping accounting exact.
- **Tick size and lot size are auto-detected from the dataset's own price/quantity increments**,
  not hardcoded — critical for correctness (see [bugs found](#notable-bugs-found-along-the-way)).
- NaN-safe: real order books can momentarily go one-sided; the guard is written as
  `not (x > 0)` rather than `x <= 0` specifically because NaN comparisons are always `False` under
  IEEE 754 and would otherwise silently poison the whole equity curve.

Metrics computed directly from the tracked equity ledger (not a black-box library call): Sharpe,
Sortino, max drawdown, total volume, fill ratio, max inventory — each with the exact formula
documented in the code.

## Making the loop actually improve

Four mechanisms turn "generate and hope" into something that compounds across runs:

1. **Cross-run memory that's actually read, not just written.** `best_runs_for_dataset()` feeds the
   top historical approaches (with their Sharpe and fill ratio) into every new run's first prompt —
   a new run starts from what already worked, not cold.
2. **Deterministic gamma grid search, no LLM.** Before the first LLM call on a dataset, the plain
   baseline is replayed across a fixed gamma grid; the winner becomes the benchmark the LLM must
   beat (and is cached per dataset so it only runs once).
3. **Forced approach diversity.** Every generated file declares a one-line `# APPROACH:` comment;
   an underperforming approach is added to a "already tried" list, and the next attempt is
   explicitly told it must pick something materially different — not just fix a typo in the same
   formula.
4. **Out-of-sample validation gate.** A candidate that beats the benchmark in-sample must also
   retain at least `OOS_MIN_RETENTION_RATIO` (default 50%) of that Sharpe on a held-out window from
   a different day. Merely "not negative" was tried first and found too weak a bar — caught live, a
   strategy scored 2.3× the benchmark in-sample and −0.002 out-of-sample; the stricter ratio check
   now catches that class of overfit explicitly, with the retention percentage shown in the
   rejection feedback.

## The dashboard

React frontend, FastAPI backend, Server-Sent Events for live streaming — no polling. `POST
/api/runs` kicks off a run in the background; `GET /api/runs/{id}/stream` streams every LangGraph
node transition as it happens (current attempt, approach description, audit findings, feedback,
final metrics) to a live progress panel. The history table shows every past run with its approach,
regime, Sharpe, out-of-sample Sharpe, and a click-through code viewer for the exact generated
source. A concurrent-run guard returns a clean `409` rather than racing two LLM loops against one
DuckDB connection.

## Security and sandboxing

- AI-generated code never has filesystem access beyond `sandbox_workspace/`, no network, no system
  calls — enforced by the static audit *and* structurally (the strategy interface never receives a
  data array to look ahead into).
- A hard subprocess timeout with process-group kill bounds a runaway or infinite-looping strategy.
- The sandbox container mounts historical data **read-only** — generated code cannot tamper with
  the ground truth it's tested against.
- The deployed single-image build folds the sandbox process into the same container as the
  orchestrator for the hackathon's single-image constraint — a deliberate, documented reduction in
  isolation strength relative to the development (multi-container) topology, not an oversight.

## Project layout

```
alpha_forge/
├── strategy_templates.py     # Avellaneda-Stoikov / GLFT math, base safety clamp
├── mcp_server.py              # FastMCP/SSE tool server (the sandbox boundary)
├── backtest_runner.py         # hftbacktest replay subprocess
├── orchestrator.py            # LangGraph pipeline, prompts, audit, self-correction
├── memory_manager.py          # DuckDB persistence, cross-run seeding, grid-search cache
├── api_server.py              # FastAPI + SSE dashboard backend
├── generate_sample_data.py    # synthetic LOB data generator
├── fetch_real_data.py         # real Bybit data downloader/converter
├── frontend/                  # React dashboard
├── historical_data/           # baked-in real + synthetic datasets
├── docker-compose.yml         # 4-container development topology
├── Dockerfile.*                # per-service dev images
├── Dockerfile                  # consolidated single-image deployment build
└── docker-entrypoint.sh        # single-image process launcher
```

## Configuration reference

All read from environment variables (`.env` in development; baked as `ENV` in the deploy image):

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` / `LLM_MODEL` | `openai` / `gpt-5.5` | synthesis model |
| `OPENAI_API_KEY` / `OPENAI_API_BASE` | — | LLM gateway credentials |
| `DATASET_NAME` / `CALIBRATION_TICKS_FILE` | `suiusdt_real_replay.npz` / `..._calibration.npz` | training window |
| `VALIDATION_DATASET_NAME` | `suiusdt_oos_replay.npz` | held-out OOS window; empty disables the gate |
| `OOS_MIN_RETENTION_RATIO` | `0.5` | required fraction of in-sample Sharpe retained OOS |
| `MAX_ATTEMPTS` | `6` | retries per run before giving up |
| `BACKTEST_TIMEOUT_SECONDS` | `120` | hard per-backtest wall-clock limit |
| `FALLBACK_T` | `3600` | trading horizon fallback, in seconds (must match the dataset's real duration) |

## Running it

**Development** (hot-reloadable, 4 containers):
```bash
docker compose up -d sandbox_execution dashboard_api dashboard_ui
# open http://localhost:3000
```

**Single-image deployment build:**
```bash
docker build --platform linux/amd64 -t alpha-forge .
docker run --rm -p 9080:9080 -p 8090:8090 alpha-forge
# open http://localhost:9080
```

## Notable bugs found along the way

Found and fixed by actually running the system end-to-end, not just reading the code:

- **Tick-size collapse.** The sandbox's `run_backtest` tool has a fixed 2-argument signature with no
  per-asset tick-size parameter, so it silently defaulted to `0.01` — a hundred times coarser than
  SUI's real `$0.0001` grid. Every strategy's distinct quoted price rounded onto the same handful of
  levels, making genuinely different formulas produce byte-identical fills and Sharpe. Fixed by
  auto-detecting tick/lot size from the dataset's own observed increments.
- **NaN-unsafe comparison.** `best_bid <= 0` doesn't catch `NaN` (NaN comparisons are always `False`
  under IEEE 754); a momentarily one-sided real order book silently poisoned the whole equity curve
  downstream. Fixed by inverting to `not (best_bid > 0)`.
- **Benchmark cross-contamination.** Volatility regime was bucketed on a hardcoded fallback sigma
  that never actually varied, so every dataset landed in the same bucket and inherited an unrelated
  dataset's high-water-mark Sharpe as its benchmark. Fixed by deriving sigma from real data and
  keying benchmarks by exact dataset name.
- **DuckDB WAL crash risk.** `ALTER TABLE ... ADD COLUMN ... DEFAULT` records replayed from the WAL
  crash this DuckDB version with an internal exception — meaning any unclean shutdown after a
  schema migration would make the memory database permanently unopenable. Fixed by avoiding
  `DEFAULT` in the migration and forcing a `CHECKPOINT` at startup.
- **Silent no-op "creativity."** The LLM would invent a plausible-sounding signal method, stub its
  body to `return 0.0`, and ship a "new approach" mathematically identical to the baseline — caught
  by comparing generated code across attempts and confirmed via a dedicated AST-based stub detector,
  now part of the risk audit.

## Known limitations

- A single fixed OOS window is still one sample — the retention-ratio gate is meaningfully stricter
  than "not negative," but multiple OOS windows would be more statistically solid.
- Fee model and order-latency values are reasonable defaults, not calibrated from Bybit's actual fee
  schedule for a specific account tier.
- Fill rates on this dataset are low (sub-1%), which makes any single Sharpe estimate noisy —
  intentional given the honest exploration this project is built around, but worth more data before
  drawing strong conclusions.
- This is a research/education sandbox, not investment advice.
