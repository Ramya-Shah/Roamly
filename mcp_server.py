"""
FastMCP tool server for Project Alpha-Forge, run entirely inside the isolated
``sandbox_execution`` container and exposed over Server-Sent Events (SSE).

This process is the *only* thing with a writable filesystem handle onto
``/app/sandbox_workspace`` and a subprocess-spawning capability. The
orchestrator container never touches the filesystem or forks processes
directly - it only calls these three tools over the network.

Tools exposed:
    - ``write_strategy_code``: persist AI-generated strategy source, with
      strict path containment so nothing can escape the workspace directory.
    - ``run_backtest``: execute ``backtest_runner.py`` as a hard-timeout
      subprocess against a read-only historical dataset.
    - ``fetch_regime_calibration``: Numba-accelerated OLS fit of the
      order-arrival intensity curve ``ln(lambda(delta)) = -k*delta + ln(A)``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import signal
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
from numba import njit

from fastmcp import FastMCP

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("alpha_forge.mcp_server")

WORKSPACE_ROOT = Path(os.environ.get("SANDBOX_WORKSPACE_DIR", "/app/sandbox_workspace")).resolve()
DATA_ROOT = Path(os.environ.get("HISTORICAL_DATA_DIR", "/app/data")).resolve()
BACKTEST_RUNNER_PATH = Path(__file__).resolve().parent / "backtest_runner.py"
BACKTEST_TIMEOUT_SECONDS = int(os.environ.get("BACKTEST_TIMEOUT_SECONDS", "120"))

_SAFE_RELATIVE_PATH_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_\-./]*$")

mcp = FastMCP("alpha-forge-sandbox")


class PathSecurityError(ValueError):
    """Raised when a caller-supplied path attempts to escape its sandbox root."""


def _resolve_within(base_dir: Path, user_supplied: str, *, must_exist: bool = False) -> Path:
    """Resolve ``user_supplied`` strictly inside ``base_dir``.

    Guards against directory traversal (``..``), absolute-path overrides,
    null-byte injection, and symlink escapes by resolving the final path and
    verifying it is still a descendant of the (already-resolved) base
    directory. This is the sole gate between untrusted LLM-authored strings
    and the filesystem.
    """
    if not user_supplied or "\x00" in user_supplied:
        raise PathSecurityError("Path must be a non-empty string with no null bytes.")
    if not _SAFE_RELATIVE_PATH_RE.match(user_supplied):
        raise PathSecurityError(
            "Path may only contain letters, digits, '_', '-', '.', '/' and must "
            "not start with '.' or '/'."
        )
    if ".." in Path(user_supplied).parts:
        raise PathSecurityError("Path traversal ('..') is not permitted.")

    candidate = (base_dir / user_supplied).resolve()

    try:
        candidate.relative_to(base_dir)
    except ValueError as exc:
        raise PathSecurityError(
            f"Resolved path '{candidate}' escapes the sandboxed root '{base_dir}'."
        ) from exc

    if must_exist and not candidate.exists():
        raise PathSecurityError(f"Required path does not exist: {user_supplied}")

    return candidate


@dataclass(frozen=True, slots=True)
class WriteResult:
    status: str
    relative_path: str
    sha256: str
    bytes_written: int


@mcp.tool()
def write_strategy_code(filename: str, code: str) -> dict[str, Any]:
    """Write AI-generated strategy source into the sandboxed workspace.

    ``filename`` is sanitized so the write can never land outside
    ``/app/sandbox_workspace`` - no absolute paths, parent-directory
    traversal, or symlink escapes are permitted. Only ``.py`` files may be
    written.

    Returns a dict with the sha256 hash of the written content rather than
    the content itself, so the calling orchestrator's state never needs to
    carry raw source code.
    """
    if not filename.endswith(".py"):
        return {"status": "error", "error": "Only '.py' strategy files may be written."}

    try:
        target = _resolve_within(WORKSPACE_ROOT, filename)
    except PathSecurityError as exc:
        logger.warning("Rejected unsafe write_strategy_code path %r: %s", filename, exc)
        return {"status": "error", "error": str(exc)}

    target.parent.mkdir(parents=True, exist_ok=True)
    encoded = code.encode("utf-8")
    target.write_bytes(encoded)

    result = WriteResult(
        status="ok",
        relative_path=str(target.relative_to(WORKSPACE_ROOT)),
        sha256=hashlib.sha256(encoded).hexdigest(),
        bytes_written=len(encoded),
    )
    logger.info("Wrote strategy file %s (%d bytes, sha256=%s)", result.relative_path,
                result.bytes_written, result.sha256)
    return asdict(result)


@mcp.tool()
def run_backtest(strategy_file: str, dataset_name: str) -> dict[str, Any]:
    """Run ``backtest_runner.py`` against ``strategy_file`` and ``dataset_name``.

    Enforces a hard wall-clock timeout (``BACKTEST_TIMEOUT_SECONDS``, default
    120s) via a dedicated process group so that a runaway or infinite-looping
    generated strategy cannot hang the sandbox container. On timeout the
    entire process group is killed and a
    ``"Throttled: Code Execution Time Limit Exceeded"`` status
    is returned. On a non-zero exit, the captured stderr traceback is
    returned verbatim for the SelfCorrectionAgent to consume.
    """
    try:
        strategy_path = _resolve_within(WORKSPACE_ROOT, strategy_file, must_exist=True)
    except PathSecurityError as exc:
        return {"status": "error", "error": str(exc)}

    try:
        dataset_path = _resolve_within(DATA_ROOT, dataset_name, must_exist=True)
    except PathSecurityError as exc:
        return {"status": "error", "error": str(exc)}

    cmd = [
        sys.executable,
        str(BACKTEST_RUNNER_PATH),
        "--strategy-file", str(strategy_path),
        "--dataset", str(dataset_path),
    ]

    popen_kwargs: dict[str, Any] = {}
    if os.name == "posix":
        popen_kwargs["start_new_session"] = True
    else:  # pragma: no cover - sandbox always runs Linux, kept for local dev
        popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP

    logger.info("Launching backtest: strategy=%s dataset=%s", strategy_file, dataset_name)
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=str(BACKTEST_RUNNER_PATH.parent),
        **popen_kwargs,
    )

    try:
        stdout, stderr = proc.communicate(timeout=BACKTEST_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        _kill_process_group(proc)
        stdout, stderr = proc.communicate()
        logger.warning("Backtest timed out: strategy=%s dataset=%s", strategy_file, dataset_name)
        return {
            "status": "timeout",
            "error": "Throttled: Code Execution Time Limit Exceeded",
            "partial_stdout": stdout[-2000:] if stdout else "",
        }

    if proc.returncode != 0:
        logger.warning("Backtest failed rc=%d strategy=%s", proc.returncode, strategy_file)
        return {
            "status": "error",
            "returncode": proc.returncode,
            "traceback": stderr.strip(),
        }

    metrics = _parse_metrics_json(stdout)
    if metrics is None:
        return {
            "status": "error",
            "traceback": f"Backtest exited 0 but produced no parseable JSON metrics. "
                         f"stdout tail: {stdout[-2000:]!r} stderr tail: {stderr[-2000:]!r}",
        }

    logger.info("Backtest completed: strategy=%s metrics=%s", strategy_file, metrics)
    return {"status": "ok", "metrics": metrics}


def _kill_process_group(proc: subprocess.Popen) -> None:
    try:
        if os.name == "posix":
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        else:  # pragma: no cover
            proc.send_signal(signal.CTRL_BREAK_EVENT)
            proc.kill()
    except ProcessLookupError:
        pass
    finally:
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def _parse_metrics_json(stdout: str) -> dict[str, Any] | None:
    """The runner is contracted to emit exactly one JSON object as its last line."""
    lines = [line for line in stdout.strip().splitlines() if line.strip()]
    if not lines:
        return None
    try:
        parsed = json.loads(lines[-1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


@njit(cache=True)
def _ols_fit(x: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    """Closed-form ordinary-least-squares slope/intercept, JIT-compiled.

    Fits ``y = slope * x + intercept`` by minimizing squared error, using
    the standard normal-equations solution so this loop compiles to native
    code via Numba's ``@njit`` rather than relying on numpy's polyfit
    machinery (which does not JIT-compile cleanly).
    """
    n = x.shape[0]
    sum_x = 0.0
    sum_y = 0.0
    sum_xy = 0.0
    sum_xx = 0.0
    for i in range(n):
        sum_x += x[i]
        sum_y += y[i]
        sum_xy += x[i] * y[i]
        sum_xx += x[i] * x[i]

    denom = n * sum_xx - sum_x * sum_x
    if denom == 0.0:
        return 0.0, (sum_y / n if n > 0 else 0.0)

    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n
    return slope, intercept


@njit(cache=True)
def _r_squared(x: np.ndarray, y: np.ndarray, slope: float, intercept: float) -> float:
    n = x.shape[0]
    mean_y = 0.0
    for i in range(n):
        mean_y += y[i]
    mean_y /= n

    ss_tot = 0.0
    ss_res = 0.0
    for i in range(n):
        predicted = slope * x[i] + intercept
        ss_res += (y[i] - predicted) ** 2
        ss_tot += (y[i] - mean_y) ** 2

    if ss_tot == 0.0:
        return 1.0
    return 1.0 - ss_res / ss_tot


@mcp.tool()
def fetch_regime_calibration(ticks_file: str, num_bins: int = 20) -> dict[str, Any]:
    """Calibrate order-arrival intensity constants ``A`` and ``k`` from tick data.

    Expects an ``.npz`` file (read-only, under ``/app/data``) containing:
        - ``mid_price``: float64 array of mid-prices, one per event.
        - ``event_price``: float64 array of resting/executed order prices,
          same length as ``mid_price``.
        - ``event_time``: float64 array of event timestamps in seconds,
          same length, monotonically non-decreasing.

    The absolute distance ``delta = |event_price - mid_price|`` is binned
    into ``num_bins`` buckets; empirical arrival intensity per bucket is
    ``count / total_observation_time``. A Numba-jitted OLS fit is then
    applied to the model:

    .. math::
        \\ln \\lambda(\\delta) = -k \\, \\delta + \\ln A

    so that ``k = -slope`` and ``A = exp(intercept)``.
    """
    try:
        dataset_path = _resolve_within(DATA_ROOT, ticks_file, must_exist=True)
    except PathSecurityError as exc:
        return {"status": "error", "error": str(exc)}

    if num_bins < 3:
        return {"status": "error", "error": "num_bins must be >= 3 for a stable fit."}

    try:
        with np.load(dataset_path) as npz:
            required = {"mid_price", "event_price", "event_time"}
            missing = required - set(npz.files)
            if missing:
                return {
                    "status": "error",
                    "error": f"ticks_file is missing required arrays: {sorted(missing)}",
                }
            mid_price = np.asarray(npz["mid_price"], dtype=np.float64)
            event_price = np.asarray(npz["event_price"], dtype=np.float64)
            event_time = np.asarray(npz["event_time"], dtype=np.float64)
    except (OSError, ValueError) as exc:
        return {"status": "error", "error": f"Failed to load ticks_file: {exc}"}

    if not (len(mid_price) == len(event_price) == len(event_time)):
        return {"status": "error", "error": "mid_price/event_price/event_time length mismatch."}
    if len(mid_price) < num_bins * 5:
        return {
            "status": "error",
            "error": f"Not enough events ({len(mid_price)}) for a {num_bins}-bin fit.",
        }

    deltas = np.abs(event_price - mid_price)
    total_observation_time = float(event_time[-1] - event_time[0])
    if total_observation_time <= 0:
        return {"status": "error", "error": "event_time span must be strictly positive."}

    # Realized volatility of the mid-price series: sum of squared absolute
    # price changes over the observation window, per unit time. This matches
    # the Avellaneda-Stoikov convention (arithmetic Brownian motion in price
    # units, not log-returns) used throughout strategy_templates.py, and its
    # units - price per sqrt(second) - match T's units (elapsed seconds).
    price_changes = np.diff(mid_price)
    sigma = float(np.sqrt(np.sum(price_changes ** 2) / total_observation_time))

    bin_edges = np.linspace(0.0, float(np.max(deltas)) + 1e-9, num_bins + 1)
    counts, _ = np.histogram(deltas, bins=bin_edges)
    bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2.0

    intensities = counts.astype(np.float64) / total_observation_time
    valid = intensities > 0
    if int(np.sum(valid)) < 3:
        return {
            "status": "error",
            "error": "Fewer than 3 non-empty bins; cannot fit a stable log-linear model.",
        }

    x = bin_centers[valid]
    y = np.log(intensities[valid])

    slope, intercept = _ols_fit(x, y)
    fit_quality = _r_squared(x, y, slope, intercept)

    k = -slope
    A = float(np.exp(intercept))

    if k <= 0:
        logger.warning("Calibration produced non-positive k=%.6f; clamping to 1e-6.", k)
        k = 1e-6

    logger.info(
        "Calibrated regime: A=%.6f k=%.6f sigma=%.6f r2=%.4f (file=%s)",
        A, k, sigma, fit_quality, ticks_file,
    )
    return {
        "status": "ok",
        "A": A,
        "k": k,
        "sigma": sigma,
        "r_squared": float(fit_quality),
        "num_events": int(len(mid_price)),
        "num_bins_used": int(np.sum(valid)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Project Alpha-Forge FastMCP sandbox server")
    parser.add_argument("--transport", default="sse", choices=["sse", "stdio", "streamable-http"])
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
    logger.info(
        "Starting alpha-forge MCP server: transport=%s host=%s port=%d workspace=%s data=%s",
        args.transport, args.host, args.port, WORKSPACE_ROOT, DATA_ROOT,
    )

    if args.transport == "stdio":
        mcp.run(transport="stdio")
    else:
        mcp.run(transport=args.transport, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
