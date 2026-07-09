"""
DuckDB-backed persistent memory for Project Alpha-Forge.

Stores one row per completed backtest run: the calibrated market constants
that produced it, the volatility regime it was classified into, its
performance metrics, and (on failure) the captured traceback. This is the
*only* thing the orchestrator persists across container restarts - raw
strategy source lives solely in ``sandbox_workspace`` and is referenced by
its sha256 hash, never duplicated into the database.

The file lives at ``/app/db/alpha_forge.duckdb`` inside the orchestrator
container, which is bind-mounted from the host's ``./memory_db`` directory
so optimization history survives ``docker compose down``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import duckdb

VolatilityRegime = Literal["low", "medium", "high", "extreme"]

DEFAULT_DB_PATH = Path(os.environ.get("MEMORY_DB_PATH", "/app/db/alpha_forge.duckdb"))

_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    run_id              VARCHAR PRIMARY KEY,
    created_at          TIMESTAMP NOT NULL DEFAULT current_timestamp,
    strategy_class      VARCHAR NOT NULL,
    strategy_filename   VARCHAR NOT NULL,
    approach            VARCHAR NOT NULL DEFAULT '',
    code_sha256         VARCHAR NOT NULL,
    dataset_name        VARCHAR NOT NULL,
    volatility_regime   VARCHAR NOT NULL,
    gamma               DOUBLE NOT NULL,
    sigma               DOUBLE NOT NULL,
    k                   DOUBLE NOT NULL,
    a_param             DOUBLE NOT NULL,
    t_horizon           DOUBLE NOT NULL,
    q_max               DOUBLE NOT NULL,
    status              VARCHAR NOT NULL,
    sharpe_ratio        DOUBLE,
    sortino_ratio       DOUBLE,
    max_drawdown        DOUBLE,
    total_volume        DOUBLE,
    fill_ratio          DOUBLE,
    max_inventory       DOUBLE,
    inventory_explosion BOOLEAN,
    traceback           VARCHAR,
    validation_sharpe   DOUBLE
);
"""

_PARAM_SEARCH_SCHEMA = """
CREATE TABLE IF NOT EXISTS param_search (
    dataset_name    VARCHAR PRIMARY KEY,
    gamma           DOUBLE NOT NULL,
    sharpe_ratio    DOUBLE,
    searched_at     TIMESTAMP NOT NULL DEFAULT current_timestamp
);
"""


@dataclass(frozen=True, slots=True)
class RunRecord:
    """Everything worth remembering about one completed (or failed) run."""

    run_id: str
    strategy_class: str
    strategy_filename: str
    code_sha256: str
    dataset_name: str
    gamma: float
    sigma: float
    k: float
    a_param: float
    t_horizon: float
    q_max: float
    status: str
    sharpe_ratio: float | None = None
    sortino_ratio: float | None = None
    max_drawdown: float | None = None
    total_volume: float | None = None
    fill_ratio: float | None = None
    max_inventory: float | None = None
    inventory_explosion: bool | None = None
    traceback: str | None = None
    approach: str = ""
    validation_sharpe: float | None = None
    volatility_regime: VolatilityRegime = field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "volatility_regime", classify_volatility_regime(self.sigma))


def classify_volatility_regime(sigma: float) -> VolatilityRegime:
    """Bucket a calibrated/observed volatility into a coarse regime label.

    Thresholds are expressed in the same per-tick price-volatility units
    produced by ``fetch_regime_calibration`` inputs; they are intentionally
    coarse since the regime label is only used to group historically similar
    runs for constant reuse, not as a precise risk signal.
    """
    if sigma < 0.005:
        return "low"
    if sigma < 0.02:
        return "medium"
    if sigma < 0.05:
        return "high"
    return "extreme"


class MemoryManager:
    """Thin, typed wrapper around a single DuckDB file for run history."""

    def __init__(self, db_path: str | Path = DEFAULT_DB_PATH) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._con = duckdb.connect(str(self.db_path))
        self._con.execute(_SCHEMA)
        # Migrates a DB file created before these columns existed, so an
        # older memory_db volume from a prior version doesn't need to be
        # wiped just to pick them up. Deliberately ADD COLUMN *without*
        # DEFAULT, then backfill: DuckDB (observed on 1.5.4) crashes with an
        # InternalException when replaying an `ALTER ... ADD COLUMN ... DEFAULT`
        # record from the WAL, which would make the DB unopenable after any
        # unclean shutdown. The CHECKPOINT then flushes the ALTERs out of the
        # WAL entirely so no schema-change record can linger there.
        self._con.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS strategy_filename VARCHAR")
        self._con.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS approach VARCHAR")
        self._con.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS validation_sharpe DOUBLE")
        self._con.execute("UPDATE runs SET strategy_filename = '' WHERE strategy_filename IS NULL")
        self._con.execute("UPDATE runs SET approach = '' WHERE approach IS NULL")
        self._con.execute(_PARAM_SEARCH_SCHEMA)
        self._con.execute("CHECKPOINT")

    def close(self) -> None:
        self._con.close()

    def __enter__(self) -> "MemoryManager":
        return self

    def __exit__(self, *_exc_info: object) -> None:
        self.close()

    def record_run(self, record: RunRecord) -> None:
        """Insert one run record. ``run_id`` collisions overwrite, by design,
        so a retried run under the same UUID never duplicates history."""
        self._con.execute(
            """
            INSERT OR REPLACE INTO runs (
                run_id, strategy_class, strategy_filename, approach, code_sha256, dataset_name,
                volatility_regime, gamma, sigma, k, a_param, t_horizon, q_max,
                status, sharpe_ratio, sortino_ratio, max_drawdown, total_volume,
                fill_ratio, max_inventory, inventory_explosion, traceback, validation_sharpe
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                record.run_id,
                record.strategy_class,
                record.strategy_filename,
                record.approach,
                record.code_sha256,
                record.dataset_name,
                record.volatility_regime,
                record.gamma,
                record.sigma,
                record.k,
                record.a_param,
                record.t_horizon,
                record.q_max,
                record.status,
                record.sharpe_ratio,
                record.sortino_ratio,
                record.max_drawdown,
                record.total_volume,
                record.fill_ratio,
                record.max_inventory,
                record.inventory_explosion,
                record.traceback,
                record.validation_sharpe,
            ],
        )

    def best_constants_for_regime(
        self, volatility_regime: VolatilityRegime, limit: int = 5
    ) -> list[dict[str, Any]]:
        """Top historical (gamma, k, A) constant sets by Sharpe for a regime.

        Used by ``StrategySynthesisAgent`` to seed a new attempt with
        constants that have historically performed well under similar
        volatility, instead of guessing cold every retry.
        """
        rows = self._con.execute(
            """
            SELECT run_id, strategy_class, gamma, sigma, k, a_param, t_horizon,
                   q_max, sharpe_ratio, sortino_ratio, max_drawdown
            FROM runs
            WHERE volatility_regime = ? AND status = 'ok' AND sharpe_ratio IS NOT NULL
            ORDER BY sharpe_ratio DESC
            LIMIT ?
            """,
            [volatility_regime, limit],
        ).fetchall()
        columns = [
            "run_id", "strategy_class", "gamma", "sigma", "k", "a_param",
            "t_horizon", "q_max", "sharpe_ratio", "sortino_ratio", "max_drawdown",
        ]
        return [dict(zip(columns, row)) for row in rows]

    def recent_failures(self, limit: int = 10) -> list[dict[str, Any]]:
        """Most recent non-'ok' runs, for surfacing repeated failure patterns."""
        rows = self._con.execute(
            """
            SELECT run_id, strategy_class, status, traceback, created_at
            FROM runs
            WHERE status != 'ok'
            ORDER BY created_at DESC
            LIMIT ?
            """,
            [limit],
        ).fetchall()
        columns = ["run_id", "strategy_class", "status", "traceback", "created_at"]
        return [dict(zip(columns, row)) for row in rows]

    def list_runs(self, limit: int = 200) -> list[dict[str, Any]]:
        """Full run history, most recent first - backs the dashboard's history table."""
        rows = self._con.execute(
            """
            SELECT run_id, created_at, strategy_class, strategy_filename, approach, code_sha256,
                   dataset_name, volatility_regime, gamma, sigma, k, a_param, t_horizon,
                   q_max, status, sharpe_ratio, sortino_ratio, max_drawdown, total_volume,
                   fill_ratio, max_inventory, inventory_explosion, traceback, validation_sharpe
            FROM runs
            ORDER BY created_at DESC
            LIMIT ?
            """,
            [limit],
        ).fetchall()
        columns = [
            "run_id", "created_at", "strategy_class", "strategy_filename", "approach", "code_sha256",
            "dataset_name", "volatility_regime", "gamma", "sigma", "k", "a_param", "t_horizon",
            "q_max", "status", "sharpe_ratio", "sortino_ratio", "max_drawdown", "total_volume",
            "fill_ratio", "max_inventory", "inventory_explosion", "traceback", "validation_sharpe",
        ]
        return [dict(zip(columns, row)) for row in rows]

    def get_param_search(self, dataset_name: str) -> dict[str, Any] | None:
        """Cached grid-search result for a dataset, or None if never searched.

        The search is deterministic for a fixed dataset (same replay, same
        grid), so one search per dataset is enough - caching avoids paying
        ~6 backtests of latency at the start of every single run.
        """
        row = self._con.execute(
            "SELECT gamma, sharpe_ratio FROM param_search WHERE dataset_name = ?",
            [dataset_name],
        ).fetchone()
        if row is None:
            return None
        return {"gamma": float(row[0]), "sharpe_ratio": row[1]}

    def save_param_search(self, dataset_name: str, gamma: float, sharpe_ratio: float | None) -> None:
        self._con.execute(
            "INSERT OR REPLACE INTO param_search (dataset_name, gamma, sharpe_ratio) VALUES (?, ?, ?)",
            [dataset_name, gamma, sharpe_ratio],
        )

    def best_runs_for_dataset(self, dataset_name: str, limit: int = 3) -> list[dict[str, Any]]:
        """Top historical approaches by Sharpe for this exact dataset.

        Fed into StrategySynthesisAgent's first-attempt prompt so a new run
        starts from what has historically worked on this market, instead of
        rediscovering the same ideas cold every time. This is what makes the
        persistent memory an actual feedback loop rather than write-only
        bookkeeping.
        """
        rows = self._con.execute(
            """
            SELECT approach, sharpe_ratio, fill_ratio
            FROM runs
            WHERE dataset_name = ? AND status = 'ok' AND sharpe_ratio IS NOT NULL
                  AND approach != ''
            ORDER BY sharpe_ratio DESC
            LIMIT ?
            """,
            [dataset_name, limit],
        ).fetchall()
        return [
            {"approach": row[0], "sharpe_ratio": row[1], "fill_ratio": row[2]}
            for row in rows
        ]

    def benchmark_sharpe(self, dataset_name: str) -> float:
        """Best-known Sharpe for this exact dataset, or 0.0 if none exists yet.

        ``SelfCorrectionAgent`` compares a new run's Sharpe against this
        value to decide whether it represents a regression worth routing
        back to synthesis. Keyed by ``dataset_name`` rather than
        ``volatility_regime``: two different markets/datasets are not a fair
        comparison for each other even if they happen to land in the same
        coarse volatility bucket, and a fixed (uncalibrated) sigma used to
        put every dataset in the same "medium" bucket regardless of the
        market actually being replayed.
        """
        row = self._con.execute(
            """
            SELECT MAX(sharpe_ratio) FROM runs
            WHERE dataset_name = ? AND status = 'ok'
            """,
            [dataset_name],
        ).fetchone()
        return float(row[0]) if row and row[0] is not None else 0.0
