"""
LangGraph orchestration pipeline for Project Alpha-Forge.

Runs entirely in the ``orchestrator`` container, which has *no* filesystem
access to strategy code or historical data - it only talks to the
``sandbox_execution`` container's FastMCP tools over SSE
(``MCP_SERVER_URL``, e.g. ``http://sandbox_execution:8000/sse``).

Graph shape (a directed cycle, terminated by a retry budget):

    synthesis -> risk_audit --(rejected, retries left)--> synthesis
                           \\--(passed)--> execution -> self_correction --(regression/failure, retries left)--> synthesis
                                                                        \\--(success or budget exhausted)--> END

State discipline: the shared ``AlphaForgeState`` never carries raw strategy
source or full backtest logs. Freshly generated code exists only in the
ephemeral ``_pending_code`` field between the synthesis and risk-audit
nodes, is never sent back into another LLM prompt, is never written to
``memory_manager``, and is discarded (set to ``None``) the moment the audit
node finishes with it - only its filename and sha256 persist onward.
"""

from __future__ import annotations

import ast
import asyncio
import json
import logging
import os
import re
import uuid
from pathlib import Path
from typing import Any, Literal, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, StateGraph

from memory_manager import MemoryManager, RunRecord, classify_volatility_regime

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("alpha_forge.orchestrator")

MCP_SERVER_URL = os.environ.get("MCP_SERVER_URL", "http://sandbox_execution:8000/sse")
# DATASET_NAME must be in hftbacktest's native tick-log replay format (consumed
# by BacktestAsset.data(...) inside backtest_runner.py). CALIBRATION_TICKS_FILE
# is a *different* schema - a plain mid_price/event_price/event_time npz
# consumed by fetch_regime_calibration - so the two are intentionally separate
# files/env vars rather than one dataset serving both purposes.
DATASET_NAME = os.environ.get("DATASET_NAME", "sample_replay.npz")
CALIBRATION_TICKS_FILE = os.environ.get("CALIBRATION_TICKS_FILE", "sample_calibration.npz")
# Optional held-out window (e.g. a different day of the same market). When
# set, a candidate that beats the benchmark in-sample must also retain at
# least OOS_MIN_RETENTION_RATIO of its in-sample Sharpe out-of-sample before
# the run is declared a success - see the overfit gate in
# self_correction_node. Empty VALIDATION_DATASET_NAME disables the gate.
VALIDATION_DATASET_NAME = os.environ.get("VALIDATION_DATASET_NAME", "")
# Merely "not negative" out-of-sample is a weak bar - a strategy can lose
# 95% of its edge and still clear it. Requiring retention of a real fraction
# of the in-sample Sharpe is a standard walk-forward-efficiency style check.
OOS_MIN_RETENTION_RATIO = float(os.environ.get("OOS_MIN_RETENTION_RATIO", "0.5"))
MAX_ATTEMPTS = int(os.environ.get("MAX_ATTEMPTS", "6"))
GAMMA_ESCALATION_FACTOR = 1.5
GAMMA_ESCALATION_CAP = 10.0

FALLBACK_SIGMA = float(os.environ.get("FALLBACK_SIGMA", "0.01"))
FALLBACK_GAMMA = float(os.environ.get("FALLBACK_GAMMA", "0.1"))
FALLBACK_T = float(os.environ.get("FALLBACK_T", "1.0"))
FALLBACK_Q_MAX = float(os.environ.get("FALLBACK_Q_MAX", "50.0"))
FALLBACK_ORDER_SIZE = float(os.environ.get("FALLBACK_ORDER_SIZE", "1.0"))


# ---------------------------------------------------------------------------
# LLM provider selection
# ---------------------------------------------------------------------------

def build_llm() -> Any:
    """Construct the chat model used by StrategySynthesisAgent.

    ``LLM_PROVIDER=openai`` (default) routes through an OpenAI-compatible
    gateway via ``OPENAI_API_BASE`` - this is how the buildathon gateway
    (a non-default ``base_url`` serving OpenAI-schema models) is wired in.
    ``LLM_PROVIDER=anthropic`` talks to the native Anthropic API instead.
    """
    provider = os.environ.get("LLM_PROVIDER", "openai").lower()

    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.")
        model = os.environ.get("LLM_MODEL", "claude-sonnet-5")
        return ChatAnthropic(model=model, api_key=api_key, temperature=0.2)

    if provider == "openai":
        from langchain_openai import ChatOpenAI

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("LLM_PROVIDER=openai but OPENAI_API_KEY is not set.")
        base_url = os.environ.get("OPENAI_API_BASE") or None
        model = os.environ.get("LLM_MODEL", "gpt-4o")
        kwargs: dict[str, Any] = {}
        # gpt-5-family (reasoning) models reject any non-default temperature
        # with a 400 (verified against the gateway); older chat models accept
        # a low temperature, which we want for code-format adherence.
        if not model.startswith("gpt-5"):
            kwargs["temperature"] = 0.2
        return ChatOpenAI(model=model, api_key=api_key, base_url=base_url, **kwargs)

    raise RuntimeError(f"Unknown LLM_PROVIDER '{provider}'; expected 'openai' or 'anthropic'.")


# ---------------------------------------------------------------------------
# Shared graph state
# ---------------------------------------------------------------------------

class RiskParamsDict(TypedDict):
    gamma: float
    sigma: float
    k: float
    A: float
    T: float
    q_max: float
    order_size: float


class AlphaForgeState(TypedDict, total=False):
    run_id: str
    dataset_name: str
    volatility_regime: str
    risk_params: RiskParamsDict
    strategy_filename: str
    code_sha256: str
    strategy_class_hint: str
    _pending_code: str | None          # ephemeral - see module docstring
    audit_passed: bool
    audit_findings: list[str]
    status: str                        # "" | "ok" | "error" | "timeout" | "audit_rejected"
    metrics: dict[str, Any]
    traceback: str
    attempt: int
    max_attempts: int
    benchmark_sharpe: float
    feedback: str                      # human-readable note for the next synthesis attempt
    done: bool
    approach_description: str          # this attempt's self-reported one-line strategic idea
    tried_approaches: list[str]        # descriptions of approaches that executed successfully
    retry_reason: str                  # "" | "crash" | "timeout" | "risk" | "quality" - see self_correction_node
    dataset_best_history: list[str]    # top prior approaches for this dataset, from persistent memory
    validation_dataset_name: str       # held-out OOS window; "" disables the overfit gate


# ---------------------------------------------------------------------------
# Static risk audit (lookahead-bias / system-call guard)
# ---------------------------------------------------------------------------

FORBIDDEN_MODULES = {
    "os", "sys", "subprocess", "socket", "shutil", "ctypes", "multiprocessing",
    "threading", "importlib", "requests", "urllib", "http", "ftplib",
    "telnetlib", "pickle", "marshal", "pathlib", "io", "asyncio", "signal",
}
FORBIDDEN_CALLS = {"eval", "exec", "compile", "__import__", "open", "input", "globals", "locals", "vars"}
FORBIDDEN_DUNDER_ATTRS = {"__bases__", "__subclasses__", "__globals__", "__code__", "__builtins__", "__mro__"}
SUSPICIOUS_LOOKAHEAD_TOKENS = {"future", "lookahead", "look_ahead", "peeknext", "peek_next", "next_tick"}


class AuditFindings(list[str]):
    """A list of human-readable audit violations; empty means the code passed."""


def audit_strategy_source(code: str) -> AuditFindings:
    """Static AST scan for system-call attempts and lookahead-bias smells.

    Note the structural mitigation for lookahead bias: generated strategies
    only ever receive ``(mid_price, inventory, t)`` for the *current* tick
    via ``compute_quotes`` - there is no data array reference passed in at
    all, so a strategy cannot index into "future" market data even if it
    wanted to. The identifier scan below is defense-in-depth against
    deliberately obfuscated attempts (e.g. smuggling a closure over
    out-of-band data), not the primary guarantee.
    """
    findings = AuditFindings()

    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        findings.append(f"SyntaxError while parsing generated code: {exc}")
        return findings

    has_strategy_assignment = any(
        isinstance(stmt, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "STRATEGY" for target in stmt.targets
        )
        for stmt in tree.body
    )
    if not has_strategy_assignment:
        findings.append(
            "Missing required module-level `STRATEGY = <ClassName>(RiskParameters(...))` "
            "assignment. Catching this here, before a write_strategy_code/run_backtest "
            "round trip, saves a guaranteed-failing backtest attempt."
        )
    if not any(isinstance(stmt, ast.ClassDef) for stmt in ast.walk(tree)):
        findings.append(
            "No class definition found; the module must define a subclass of "
            "AvellanedaStoikovStrategy or GLFTStrategy."
        )

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root in FORBIDDEN_MODULES:
                    findings.append(f"Forbidden import: '{alias.name}'")
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root in FORBIDDEN_MODULES:
                findings.append(f"Forbidden import-from: '{node.module}'")
        elif isinstance(node, ast.Call):
            func = node.func
            name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)
            if name in FORBIDDEN_CALLS:
                findings.append(f"Forbidden call: '{name}(...)'")
        elif isinstance(node, ast.Attribute):
            if node.attr in FORBIDDEN_DUNDER_ATTRS:
                findings.append(f"Forbidden introspection attribute access: '.{node.attr}'")
        elif isinstance(node, ast.FunctionDef):
            if node.name == "compute_quotes":
                findings.append(
                    "Strategy overrides `compute_quotes` directly, which bypasses the "
                    "mandatory inventory-explosion safety clamp; override "
                    "`_reservation_and_spread` instead."
                )

        # Checked independently of the branches above (not `elif`) so that
        # e.g. `self.future_price` is still scanned for a suspicious token
        # even though its `ast.Attribute` node already matched the dunder
        # check above.
        if isinstance(node, (ast.Name, ast.Attribute)):
            token = getattr(node, "id", None) or getattr(node, "attr", None) or ""
            if token.lower().replace("_", "") in SUSPICIOUS_LOOKAHEAD_TOKENS:
                findings.append(f"Suspicious lookahead-bias identifier: '{token}'")

    findings.extend(_find_placeholder_stubs(tree))
    return findings


def _find_placeholder_stubs(tree: ast.Module) -> list[str]:
    """Flag helper methods whose entire body is `return <constant>`.

    Observed failure mode: the model invents a plausible signal method
    (``get_trade_flow_imbalance``, ``get_momentum``, ...) whose body is a
    placeholder ``return 0.0`` with a comment saying "in practice this would
    analyze real data". The adjustment it feeds is then mathematically zero,
    so the "new approach" is a byte-identical no-op of the baseline - it
    executes cleanly, scores identically, and silently wastes the attempt.
    Rejecting it at audit time (with an actionable message) costs one cheap
    LLM round trip instead of a full backtest that measures nothing.
    """
    stub_findings: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        for method in node.body:
            if not isinstance(method, ast.FunctionDef):
                continue
            if method.name in ("_reservation_and_spread", "__init__"):
                continue
            body = list(method.body)
            # Skip a leading docstring when judging the real body.
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                body = body[1:]
            if len(body) == 1 and isinstance(body[0], ast.Return) and isinstance(
                body[0].value, (ast.Constant, type(None))
            ):
                stub_findings.append(
                    f"Method '{method.name}' is a placeholder stub that just returns a "
                    "constant, which makes any adjustment computed from it a no-op - the "
                    "strategy degenerates to the unmodified baseline while claiming to be a "
                    "new approach. Either genuinely compute the signal from the inputs you "
                    "actually have - (mid_price, inventory, t) plus rolling state you maintain "
                    "yourself in instance attributes across calls (e.g. self._prev_mid) - or "
                    "drop the idea entirely."
                )
    return stub_findings


def _parse_tool_result(result: Any) -> dict[str, Any]:
    """Normalize an MCP tool call's return value into a plain dict.

    ``langchain-mcp-adapters`` (confirmed against the installed
    langchain-mcp-adapters==0.3.0 / langchain-core==1.4.8) returns tool
    results as a list of MCP content blocks, e.g.
    ``[{"type": "text", "text": "<json string>"}]`` - not a bare dict and
    not a bare JSON string. This handles that shape along with a plain dict
    or a raw JSON string, in case of an adapter version difference.
    """
    if isinstance(result, dict):
        return result
    if isinstance(result, str):
        return json.loads(result)
    if isinstance(result, list):
        if not result:
            raise ValueError("MCP tool returned an empty content-block list.")
        first = result[0]
        text = first.get("text") if isinstance(first, dict) else getattr(first, "text", None)
        if text is None:
            raise ValueError(f"MCP tool content block has no 'text' field: {first!r}")
        return json.loads(text)
    raise TypeError(f"Unrecognized MCP tool result shape: {type(result)!r}")


def _extract_code(llm_text: str) -> str:
    """Strip an optional ```python fenced block from the LLM's raw response."""
    match = re.search(r"```(?:python)?\s*(.*?)```", llm_text, re.DOTALL)
    return match.group(1).strip() if match else llm_text.strip()


def _extract_approach(code: str) -> str:
    """Pull the self-reported `# APPROACH: ...` line out of generated code.

    Searched across the first few lines (not strictly line 1) since a model
    occasionally prepends a module docstring despite instructions. Falls
    back to a generic label rather than failing - this is a soft tracking
    aid for prompting diversity, not something worth burning an audit
    rejection over.
    """
    for line in code.splitlines()[:5]:
        match = re.match(r"\s*#\s*APPROACH:\s*(.+)", line)
        if match:
            return match.group(1).strip()
    return "unnamed approach"


# ---------------------------------------------------------------------------
# Node factories
# ---------------------------------------------------------------------------

SYSTEM_PROMPT_TEMPLATE = """You are the StrategySynthesisAgent inside an offline, sandboxed HFT \
strategy-generation pipeline. You write exactly one Python module per turn that will be executed \
inside an isolated Docker container against replayed historical limit-order-book data.

STRICT OUTPUT RULES:
- Output ONLY raw Python source code. No markdown fences, no prose, no explanations.
- The FIRST line of the file MUST be a comment naming your strategic approach in 5-10 words, exactly \
in this form: `# APPROACH: <description>`, e.g. `# APPROACH: GLFT baseline, unmodified` or \
`# APPROACH: Avellaneda-Stoikov with trade-flow-imbalance skew`. This is used to track which distinct \
ideas have already been tried this run - it is not optional and not decorative.
- The module MUST include: `from strategy_templates import AvellanedaStoikovStrategy, GLFTStrategy, RiskParameters`
- The module MUST define a subclass of AvellanedaStoikovStrategy or GLFTStrategy. You MAY override \
`_reservation_and_spread(self, mid_price, inventory, t)` to refine the quoting logic, but you MUST \
NEVER override `compute_quotes` directly - that method carries the mandatory inventory-explosion \
safety clamp and must remain intact.
- `_reservation_and_spread` MUST `return` exactly 3 floats, in this order: \
`(reservation_price, delta_bid, delta_ask)`. `delta_bid` and `delta_ask` are non-negative offsets \
FROM the reservation price (the caller computes `bid_price = reservation_price - delta_bid` and \
`ask_price = reservation_price + delta_ask`) - they are not the absolute bid/ask prices themselves. \
Even for a symmetric spread you must still return both values separately, e.g. \
`return reservation_price, half_spread, half_spread` - never `return reservation_price, half_spread` \
(that is only 2 values and will crash with `ValueError: not enough values to unpack`).
- The module MUST define a module-level instance exactly as:
  STRATEGY = <YourClassName>(RiskParameters(gamma={gamma}, sigma={sigma}, k={k}, A={a_param}, T={t_horizon}, q_max={q_max}, order_size={order_size}))
  Use these numeric values verbatim - they come from live market calibration and risk-control logic \
you are not permitted to override.
- Inside `_reservation_and_spread`, read these values back via `self.risk_params.gamma`, \
`self.risk_params.sigma`, `self.risk_params.k`, `self.risk_params.A`, `self.risk_params.T`, \
`self.risk_params.q_max`, `self.risk_params.order_size`. The attribute is `self.risk_params` \
(matching the constructor argument name) - it is NOT `self.risk_parameters`, `self.params`, or \
`self.risk`, and referencing anything other than `self.risk_params` will crash with AttributeError.
- Only `strategy_templates` and Python's built-in `math` module may be imported. No file, network, \
process, or system access of any kind - the sandbox has none available and any attempt will be \
statically rejected before execution.
- The ONLY market inputs you receive are the arguments of `_reservation_and_spread`: the current \
`mid_price`, your signed `inventory`, and elapsed time `t`. There is NO API for order-book depth, \
trade flow, or volume - do NOT invent methods like `get_trade_flow_imbalance()` or \
`get_recent_buy_orders()` that pretend such data exists.
- NO placeholder stubs: a helper method whose body is just `return 0.0` (or any constant) makes \
your adjustment a mathematical no-op and will be statically rejected. If an approach needs a \
signal, COMPUTE it from what you have. You MAY maintain rolling state across calls in instance \
attributes - e.g. track `self._prev_mid` to compute short-term momentum, or an EWMA of squared \
mid-price changes for realized volatility - initialize them lazily with `getattr(self, '_name', default)`.
"""


def _build_human_prompt(state: AlphaForgeState) -> str:
    lines = [
        f"Volatility regime: {state['volatility_regime']}",
        f"Benchmark Sharpe ratio to beat: {state.get('benchmark_sharpe', 0.0):.4f}",
        f"Attempt {state.get('attempt', 0) + 1} of {state.get('max_attempts', MAX_ATTEMPTS)}.",
    ]
    if state.get("strategy_class_hint"):
        lines.append(f"Suggested base class: {state['strategy_class_hint']}")

    tried = state.get("tried_approaches") or []
    if tried:
        lines.append("\nApproaches already tried this run (and their outcome is already known):")
        lines.extend(f"  - {a}" for a in tried)

    feedback = state.get("feedback")
    retry_reason = state.get("retry_reason", "")

    if retry_reason == "quality":
        lines.append(
            "\nThe previous approach executed successfully but did not beat the benchmark Sharpe. "
            "You MUST now use a MATERIALLY DIFFERENT approach from every one listed above - not a "
            "minor constant tweak or a cosmetic rename. Either switch to the other base class "
            "(AvellanedaStoikovStrategy <-> GLFTStrategy), or add a genuinely different signal to "
            "`_reservation_and_spread` - e.g. trade-flow/order-imbalance-based skew, momentum-adjusted "
            "reservation price, volatility-clustering-aware spread widening, or asymmetric sizing. "
            f"\n\nFeedback from that attempt:\n{feedback}"
        )
    elif feedback:
        lines.append(
            f"\nFeedback from the previous attempt (fix this, keeping the same approach - this is a "
            f"bug-fix, not a strategy change):\n{feedback}"
        )
    else:
        history = state.get("dataset_best_history") or []
        if history:
            lines.append(
                "\nThis is the first attempt for this run. Best historical approaches on this "
                "exact dataset (from persistent cross-run memory) - start from the strongest of "
                "these rather than rediscovering from scratch, and improve on it:"
            )
            lines.extend(f"  - {h}" for h in history)
        else:
            lines.append("\nThis is the first attempt for this run; use the Avellaneda-Stoikov baseline.")
    return "\n".join(lines)


def make_synthesis_node(llm: Any):
    async def synthesis_node(state: AlphaForgeState) -> dict[str, Any]:
        risk_params = state["risk_params"]
        system_msg = SystemMessage(
            content=SYSTEM_PROMPT_TEMPLATE.format(
                gamma=risk_params["gamma"],
                sigma=risk_params["sigma"],
                k=risk_params["k"],
                a_param=risk_params["A"],
                t_horizon=risk_params["T"],
                q_max=risk_params["q_max"],
                order_size=risk_params["order_size"],
            )
        )
        human_msg = HumanMessage(content=_build_human_prompt(state))

        response = await llm.ainvoke([system_msg, human_msg])
        code = _extract_code(response.content if isinstance(response.content, str) else str(response.content))
        approach = _extract_approach(code)

        attempt = state.get("attempt", 0) + 1
        filename = f"strategy_{state['run_id']}_attempt{attempt}.py"

        logger.info(
            "SynthesisAgent produced attempt %d for run %s (approach: %s)",
            attempt, state["run_id"], approach,
        )
        return {
            "_pending_code": code,
            "strategy_filename": filename,
            "attempt": attempt,
            "approach_description": approach,
        }

    return synthesis_node


def make_risk_audit_node(mcp_tools: dict[str, Any]):
    write_tool = mcp_tools["write_strategy_code"]

    async def risk_audit_node(state: AlphaForgeState) -> dict[str, Any]:
        code = state.get("_pending_code") or ""
        findings = audit_strategy_source(code)

        if findings:
            logger.warning("RiskAuditAgent rejected attempt %d: %s", state.get("attempt", 0), findings)
            return {
                "_pending_code": None,
                "audit_passed": False,
                "audit_findings": list(findings),
                "feedback": "Static risk audit rejected the previous attempt:\n"
                            + "\n".join(f"- {f}" for f in findings),
            }

        result = await write_tool.ainvoke({"filename": state["strategy_filename"], "code": code})
        payload = _parse_tool_result(result)
        if payload.get("status") != "ok":
            return {
                "_pending_code": None,
                "audit_passed": False,
                "audit_findings": [payload.get("error", "unknown write_strategy_code failure")],
                "feedback": f"Failed to persist strategy file: {payload.get('error')}",
            }

        logger.info("RiskAuditAgent passed attempt %d (sha256=%s)", state.get("attempt", 0), payload["sha256"])
        return {
            "_pending_code": None,
            "audit_passed": True,
            "audit_findings": [],
            "code_sha256": payload["sha256"],
        }

    return risk_audit_node


def make_execution_node(mcp_tools: dict[str, Any]):
    run_tool = mcp_tools["run_backtest"]

    async def execution_node(state: AlphaForgeState) -> dict[str, Any]:
        result = await run_tool.ainvoke(
            {"strategy_file": state["strategy_filename"], "dataset_name": state["dataset_name"]}
        )
        payload = _parse_tool_result(result)

        status = payload.get("status", "error")
        update: dict[str, Any] = {"status": status}
        if status == "ok":
            update["metrics"] = payload["metrics"]
            update["traceback"] = ""
        elif status == "timeout":
            update["traceback"] = payload.get("error", "Throttled: Code Execution Time Limit Exceeded")
            update["metrics"] = {}
        else:
            update["traceback"] = payload.get("traceback", payload.get("error", "unknown execution failure"))
            update["metrics"] = {}

        logger.info("ExecutionAgent run status=%s run_id=%s", status, state["run_id"])
        return update

    return execution_node


def _diagnose_metrics(metrics: dict[str, Any]) -> str:
    """Turn a raw metrics dict into a short, causally-actionable diagnosis.

    A bare number like "sharpe=-0.0003" doesn't tell a model *why* it's
    losing. On a thin real market, fill_ratio is usually the dominant
    signal: a strategy that almost never gets filled will show a
    near-identical, near-zero Sharpe no matter how clever its formula is,
    because nothing it does differently ever gets tested against real order
    flow. Surfacing that distinction lets the model diagnose "I'm not
    getting filled" instead of blindly trying yet another formula that also
    never trades.
    """
    fill_ratio = metrics.get("fill_ratio") or 0.0
    filled = metrics.get("filled_orders", 0)
    canceled = metrics.get("canceled_orders", 0)
    drawdown = metrics.get("max_drawdown", 0.0)
    volume = metrics.get("total_volume", 0.0)
    max_inv = metrics.get("max_inventory", 0.0)

    lines = [
        f"Diagnostics: filled={filled}, canceled={canceled}, fill_ratio={fill_ratio:.4%}, "
        f"total_volume={volume:.2f}, max_drawdown={drawdown:.6f}, max_inventory={max_inv:.2f}."
    ]

    if fill_ratio < 0.01:
        lines.append(
            "Fill ratio is near zero - your quotes are almost never actually resting close "
            "enough to the touch to get matched by real order flow, so this Sharpe is closer to "
            "noise than a real quality signal. Formula cleverness will not help until this "
            "improves. Try reducing the effective half-spread (e.g. scale down the "
            "(2/gamma)*ln(1+gamma/k) term in Avellaneda-Stoikov, or the half_spread term in GLFT) "
            "so your bid/ask sit closer to the real market's own spread."
        )
    elif fill_ratio < 0.05:
        lines.append(
            "Fill ratio is low but non-zero - you are trading, just infrequently. Consider "
            "whether tightening the spread further (accepting more adverse-selection risk) would "
            "generate enough additional fills to make the Sharpe estimate more reliable."
        )
    else:
        lines.append(
            "Fill ratio is reasonable, so this Sharpe reflects real trading activity rather than "
            "noise from a handful of fills. Weak PnL here likely comes from adverse selection "
            "(getting filled right before the price moves against you), not a fill-rate problem - "
            "consider asymmetric skewing that widens the side more likely to be picked off during "
            "directional moves."
        )
    return "\n".join(lines)


def make_self_correction_node(memory: MemoryManager, mcp_tools: dict[str, Any]):
    run_tool = mcp_tools["run_backtest"]

    async def self_correction_node(state: AlphaForgeState) -> dict[str, Any]:
        risk_params = dict(state["risk_params"])
        status = state["status"]
        metrics = dict(state.get("metrics", {}))
        attempt = state.get("attempt", 0)
        max_attempts = state.get("max_attempts", MAX_ATTEMPTS)

        # Out-of-sample gate: a candidate that beat the benchmark on the
        # training window must also not lose money on a window it was never
        # tuned against, or the "win" is likely curve-fitting. Run this
        # BEFORE recording so validation_sharpe lands in the run's row, and
        # only for would-be winners - failures don't earn the extra backtest.
        validation_sharpe: float | None = None
        validation_ds = state.get("validation_dataset_name") or ""
        is_win_candidate = (
            status == "ok"
            and not metrics.get("inventory_explosion")
            and metrics.get("sharpe_ratio", float("-inf")) >= state.get("benchmark_sharpe", 0.0)
        )
        if validation_ds and is_win_candidate:
            try:
                val_result = await run_tool.ainvoke(
                    {"strategy_file": state["strategy_filename"], "dataset_name": validation_ds}
                )
                val_payload = _parse_tool_result(val_result)
                if val_payload.get("status") == "ok":
                    validation_sharpe = float(val_payload["metrics"].get("sharpe_ratio", float("-inf")))
                else:
                    # Crashing or timing out on unseen data is itself a failure.
                    validation_sharpe = float("-inf")
            except Exception as exc:  # noqa: BLE001 - degrade to unvalidated rather than crash the run
                logger.warning("OOS validation call failed (%s); treating candidate as unvalidated.", exc)
            if validation_sharpe is not None:
                metrics["validation_sharpe"] = validation_sharpe

        record = RunRecord(
            run_id=f"{state['run_id']}-attempt{attempt}",
            strategy_class=state.get("strategy_class_hint", "unknown"),
            strategy_filename=state.get("strategy_filename", ""),
            approach=state.get("approach_description", ""),
            code_sha256=state.get("code_sha256", ""),
            dataset_name=state["dataset_name"],
            gamma=risk_params["gamma"],
            sigma=risk_params["sigma"],
            k=risk_params["k"],
            a_param=risk_params["A"],
            t_horizon=risk_params["T"],
            q_max=risk_params["q_max"],
            status=status,
            sharpe_ratio=metrics.get("sharpe_ratio"),
            sortino_ratio=metrics.get("sortino_ratio"),
            max_drawdown=metrics.get("max_drawdown"),
            total_volume=metrics.get("total_volume"),
            fill_ratio=metrics.get("fill_ratio"),
            max_inventory=metrics.get("max_inventory"),
            inventory_explosion=metrics.get("inventory_explosion"),
            traceback=state.get("traceback") or None,
            validation_sharpe=validation_sharpe,
        )
        memory.record_run(record)

        budget_exhausted = attempt >= max_attempts
        approach = state.get("approach_description", "unnamed approach")

        if status == "timeout":
            feedback = (
                "The previous attempt timed out (Throttled: Code Execution Time Limit Exceeded). "
                "Simplify the strategy: avoid any unbounded loops or expensive per-tick computation "
                "in `_reservation_and_spread`; it must be O(1) per call."
            )
            return {"feedback": feedback, "done": budget_exhausted, "retry_reason": "timeout"}

        if status != "ok":
            feedback = f"The previous attempt failed to execute:\n{state.get('traceback', '')}"
            return {"feedback": feedback, "done": budget_exhausted, "retry_reason": "crash"}

        if metrics.get("inventory_explosion"):
            new_gamma = min(risk_params["gamma"] * GAMMA_ESCALATION_FACTOR, GAMMA_ESCALATION_CAP)
            risk_params["gamma"] = new_gamma
            logger.warning(
                "Inventory Explosion Warning for run %s: escalating gamma to %.4f",
                state["run_id"], new_gamma,
            )
            feedback = (
                f"Inventory Explosion Warning: max_inventory={metrics['max_inventory']:.2f} reached "
                f"the risk bound. Risk-aversion gamma has been forcibly increased to {new_gamma:.4f}; "
                "use this new value and quote more conservatively around the reservation price."
            )
            return {"risk_params": risk_params, "feedback": feedback, "done": budget_exhausted, "retry_reason": "risk"}

        benchmark = state.get("benchmark_sharpe", 0.0)
        sharpe = metrics.get("sharpe_ratio", float("-inf"))
        if sharpe < benchmark:
            # This approach executed cleanly and got a fair quality comparison,
            # so it's now "spent" - _build_human_prompt forces the next attempt
            # to pick something materially different from everything in this list.
            tried = list(state.get("tried_approaches", []))
            tried.append(f"{approach} (Sharpe {sharpe:.4f})")
            feedback = (
                f"Sharpe ratio {sharpe:.4f} did not beat the benchmark {benchmark:.4f}.\n"
                f"{_diagnose_metrics(metrics)}"
            )
            return {
                "feedback": feedback,
                "done": budget_exhausted,
                "retry_reason": "quality",
                "tried_approaches": tried,
            }

        # Required minimum OOS Sharpe to pass, scaled to the in-sample result:
        # e.g. with the 0.5 default and sharpe=0.004, OOS must be >= 0.002.
        # min(..., 0) guards the (rare) sharpe<=0 edge case so the threshold
        # never flips sign and accidentally rewards a worse OOS result.
        required_oos_sharpe = min(sharpe, 0.0) if sharpe <= 0 else sharpe * OOS_MIN_RETENTION_RATIO
        if validation_sharpe is not None and validation_sharpe < required_oos_sharpe:
            # Beat the benchmark in-sample but didn't retain enough of that
            # edge out-of-sample: overfit to the training window, not a real edge.
            retention_pct = (validation_sharpe / sharpe * 100) if sharpe > 0 else float("-inf")
            tried = list(state.get("tried_approaches", []))
            tried.append(
                f"{approach} (train Sharpe {sharpe:.4f}, OOS Sharpe {validation_sharpe:.4f} "
                f"[{retention_pct:.0f}% retained, need >={OOS_MIN_RETENTION_RATIO:.0%}] - overfit, rejected)"
            )
            feedback = (
                f"Overfitting detected: Sharpe {sharpe:.4f} beat the benchmark on the training "
                f"window, but on the held-out out-of-sample window ('{validation_ds}', a different "
                f"day of the same market that you were never scored against) it only scored "
                f"{validation_sharpe:.4f} - retaining {retention_pct:.0f}% of the in-sample edge, "
                f"below the required {OOS_MIN_RETENTION_RATIO:.0%}. A real edge must generalize - "
                "prefer robust, regime-agnostic logic over anything finely tuned to one window's "
                "price path.\n"
                f"{_diagnose_metrics(metrics)}"
            )
            return {
                "metrics": metrics,
                "feedback": feedback,
                "done": budget_exhausted,
                "retry_reason": "quality",
                "tried_approaches": tried,
            }

        if validation_sharpe is not None:
            logger.info(
                "Run %s succeeded: sharpe=%.4f (benchmark %.4f), OOS sharpe=%.4f",
                state["run_id"], sharpe, benchmark, validation_sharpe,
            )
        else:
            logger.info("Run %s succeeded: sharpe=%.4f (benchmark was %.4f)", state["run_id"], sharpe, benchmark)
        return {"metrics": metrics, "benchmark_sharpe": sharpe, "feedback": "", "done": True, "retry_reason": ""}

    return self_correction_node


# ---------------------------------------------------------------------------
# Graph wiring
# ---------------------------------------------------------------------------

def route_after_audit(state: AlphaForgeState) -> Literal["execution", "synthesis", "abort"]:
    if state.get("audit_passed"):
        return "execution"
    if state.get("attempt", 0) >= state.get("max_attempts", MAX_ATTEMPTS):
        return "abort"
    return "synthesis"


def route_after_correction(state: AlphaForgeState) -> Literal["synthesis", "end"]:
    return "end" if state.get("done") else "synthesis"


def build_graph(llm: Any, mcp_tools: dict[str, Any], memory: MemoryManager):
    graph = StateGraph(AlphaForgeState)
    graph.add_node("synthesis", make_synthesis_node(llm))
    graph.add_node("risk_audit", make_risk_audit_node(mcp_tools))
    graph.add_node("execution", make_execution_node(mcp_tools))
    graph.add_node("self_correction", make_self_correction_node(memory, mcp_tools))

    graph.set_entry_point("synthesis")
    graph.add_edge("synthesis", "risk_audit")
    graph.add_conditional_edges(
        "risk_audit", route_after_audit, {"execution": "execution", "synthesis": "synthesis", "abort": END}
    )
    graph.add_edge("execution", "self_correction")
    graph.add_conditional_edges(
        "self_correction", route_after_correction, {"synthesis": "synthesis", "end": END}
    )
    return graph.compile()


# ---------------------------------------------------------------------------
# Bootstrap: MCP client, initial calibration, run loop
# ---------------------------------------------------------------------------

async def _calibrate_initial_risk_params(
    mcp_tools: dict[str, Any], calibration_ticks_file: str
) -> RiskParamsDict:
    """Best-effort calibration via fetch_regime_calibration, with a documented fallback.

    On a fresh deployment ``historical_data`` may not yet contain a tick file
    shaped for calibration (see ``mcp_server.fetch_regime_calibration``'s
    required ``mid_price``/``event_price``/``event_time`` arrays). That is an
    expected first-run condition, not an error - we fall back to the
    conservative constants above and let subsequent runs improve on them via
    ``memory_manager``.
    """
    calibration_tool = mcp_tools["fetch_regime_calibration"]
    try:
        result = await calibration_tool.ainvoke({"ticks_file": calibration_ticks_file})
        payload = _parse_tool_result(result)
    except Exception as exc:  # noqa: BLE001 - genuinely any tool/transport error is non-fatal here
        logger.warning("Calibration call raised %s; using fallback constants.", exc)
        payload = {"status": "error"}

    if payload.get("status") == "ok":
        # sigma comes from real realized-volatility calibration now (see
        # mcp_server.fetch_regime_calibration); FALLBACK_SIGMA is only a
        # floor against a degenerate all-flat mid-price series, not the
        # normal path. Getting this right matters beyond the formula itself:
        # classify_volatility_regime(sigma) buckets runs for benchmark
        # lookups, so a fixed sigma would have every dataset compared
        # against the same "medium" bucket's history regardless of the
        # market actually being replayed.
        calibrated_sigma = float(payload.get("sigma", 0.0))
        sigma = calibrated_sigma if calibrated_sigma > 0 else FALLBACK_SIGMA
        return RiskParamsDict(
            gamma=FALLBACK_GAMMA,
            sigma=sigma,
            k=payload["k"],
            A=payload["A"],
            T=FALLBACK_T,
            q_max=FALLBACK_Q_MAX,
            order_size=FALLBACK_ORDER_SIZE,
        )

    logger.warning(
        "Falling back to default risk parameters (calibration file '%s' unavailable or invalid).",
        calibration_ticks_file,
    )
    return RiskParamsDict(
        gamma=FALLBACK_GAMMA,
        sigma=FALLBACK_SIGMA,
        k=1.5,
        A=140.0,
        T=FALLBACK_T,
        q_max=FALLBACK_Q_MAX,
        order_size=FALLBACK_ORDER_SIZE,
    )


async def connect_mcp_tools() -> dict[str, Any]:
    """Connect to the sandbox's FastMCP server over SSE and return its tools by name.

    Extracted out of ``run_pipeline`` so ``api_server.py`` can set up the MCP
    connection once at startup and reuse it across many runs, rather than
    reconnecting per request.
    """
    from langchain_mcp_adapters.client import MultiServerMCPClient

    client = MultiServerMCPClient(
        {"alpha_forge_sandbox": {"url": MCP_SERVER_URL, "transport": "sse"}}
    )
    tool_list = await client.get_tools()
    mcp_tools = {tool.name: tool for tool in tool_list}
    for required in ("write_strategy_code", "run_backtest", "fetch_regime_calibration"):
        if required not in mcp_tools:
            raise RuntimeError(f"MCP server did not expose required tool '{required}'.")
    return mcp_tools


# ---------------------------------------------------------------------------
# Deterministic parameter search (no LLM)
# ---------------------------------------------------------------------------

GRID_GAMMAS = [0.01, 0.05, 0.1, 0.5, 1.0, 2.0]

_GRID_BASELINE_TEMPLATE = """# APPROACH: Grid-search tuned Avellaneda-Stoikov baseline (gamma={gamma})
from strategy_templates import AvellanedaStoikovStrategy, RiskParameters

STRATEGY = AvellanedaStoikovStrategy(RiskParameters(
    gamma={gamma}, sigma={sigma}, k={k}, A={A}, T={T}, q_max={q_max}, order_size={order_size},
))
"""


async def run_param_search(
    mcp_tools: dict[str, Any], memory: MemoryManager, dataset_name: str, risk_params: RiskParamsDict
) -> RiskParamsDict:
    """One-time-per-dataset grid search over gamma using the plain baseline.

    Spread width - driven almost entirely by gamma via the
    (2/gamma)*ln(1+gamma/k) term - usually dominates whether a market-maker
    gets filled at all, which matters more than any formula creativity the
    LLM adds on top. This stage is deliberately deterministic and LLM-free:
    it replays the identical baseline strategy across GRID_GAMMAS, keeps the
    best, records that winner as a normal run (so benchmark_sharpe and the
    memory seeding both pick it up automatically - the LLM must now beat a
    *tuned* baseline, not a guessed one), and caches the result in the
    param_search table so subsequent runs skip the ~6 extra backtests.
    """
    cached = memory.get_param_search(dataset_name)
    if cached is not None:
        tuned = dict(risk_params)
        tuned["gamma"] = cached["gamma"]
        logger.info(
            "Param search cache hit for %s: gamma=%.4g (sharpe %.4f at search time)",
            dataset_name, cached["gamma"], cached["sharpe_ratio"] or 0.0,
        )
        return RiskParamsDict(**tuned)

    write_tool = mcp_tools["write_strategy_code"]
    run_tool = mcp_tools["run_backtest"]
    logger.info("Running gamma grid search for %s over %s ...", dataset_name, GRID_GAMMAS)

    best_gamma = risk_params["gamma"]
    best_sharpe = float("-inf")
    best_metrics: dict[str, Any] = {}
    best_filename = ""

    for gamma in GRID_GAMMAS:
        filename = f"gridsearch_{Path(dataset_name).stem}_gamma_{str(gamma).replace('.', 'p')}.py"
        code = _GRID_BASELINE_TEMPLATE.format(
            gamma=gamma,
            sigma=risk_params["sigma"],
            k=risk_params["k"],
            A=risk_params["A"],
            T=risk_params["T"],
            q_max=risk_params["q_max"],
            order_size=risk_params["order_size"],
        )
        try:
            write_payload = _parse_tool_result(await write_tool.ainvoke({"filename": filename, "code": code}))
            if write_payload.get("status") != "ok":
                logger.warning("Grid point gamma=%s: write failed (%s); skipping.", gamma, write_payload.get("error"))
                continue
            run_payload = _parse_tool_result(
                await run_tool.ainvoke({"strategy_file": filename, "dataset_name": dataset_name})
            )
        except Exception as exc:  # noqa: BLE001 - a single bad grid point shouldn't kill the search
            logger.warning("Grid point gamma=%s raised %s; skipping.", gamma, exc)
            continue

        if run_payload.get("status") != "ok":
            logger.warning("Grid point gamma=%s: backtest failed; skipping.", gamma)
            continue
        sharpe = run_payload["metrics"].get("sharpe_ratio", float("-inf"))
        logger.info("Grid point gamma=%s -> sharpe=%.6f", gamma, sharpe)
        if sharpe > best_sharpe:
            best_gamma, best_sharpe = gamma, sharpe
            best_metrics = run_payload["metrics"]
            best_filename = filename

    if best_sharpe == float("-inf"):
        logger.warning("Grid search produced no successful runs; keeping calibrated defaults.")
        return risk_params

    memory.save_param_search(dataset_name, best_gamma, best_sharpe)
    memory.record_run(RunRecord(
        # Stable id: re-searching the same dataset overwrites rather than duplicates.
        run_id=f"gridsearch-{Path(dataset_name).stem}",
        strategy_class="AvellanedaStoikovStrategy",
        strategy_filename=best_filename,
        approach=f"Grid-search tuned baseline (gamma={best_gamma})",
        code_sha256="",
        dataset_name=dataset_name,
        gamma=best_gamma,
        sigma=risk_params["sigma"],
        k=risk_params["k"],
        a_param=risk_params["A"],
        t_horizon=risk_params["T"],
        q_max=risk_params["q_max"],
        status="ok",
        sharpe_ratio=best_metrics.get("sharpe_ratio"),
        sortino_ratio=best_metrics.get("sortino_ratio"),
        max_drawdown=best_metrics.get("max_drawdown"),
        total_volume=best_metrics.get("total_volume"),
        fill_ratio=best_metrics.get("fill_ratio"),
        max_inventory=best_metrics.get("max_inventory"),
        inventory_explosion=best_metrics.get("inventory_explosion"),
    ))
    logger.info("Grid search winner for %s: gamma=%.4g (sharpe=%.6f)", dataset_name, best_gamma, best_sharpe)

    tuned = dict(risk_params)
    tuned["gamma"] = best_gamma
    return RiskParamsDict(**tuned)


async def build_initial_state(
    mcp_tools: dict[str, Any],
    memory: MemoryManager,
    dataset_name: str = DATASET_NAME,
    calibration_ticks_file: str = CALIBRATION_TICKS_FILE,
    validation_dataset_name: str = VALIDATION_DATASET_NAME,
) -> AlphaForgeState:
    """Calibrate risk parameters and assemble a fresh run's starting state."""
    risk_params = await _calibrate_initial_risk_params(mcp_tools, calibration_ticks_file)
    # Deterministic gamma tuning runs after calibration (it needs sigma/k/A)
    # and before benchmark lookup (it may set a new benchmark itself).
    risk_params = await run_param_search(mcp_tools, memory, dataset_name, risk_params)
    volatility_regime = classify_volatility_regime(risk_params["sigma"])
    benchmark_sharpe = memory.benchmark_sharpe(dataset_name)
    dataset_best_history = [
        f"{r['approach']} (Sharpe {r['sharpe_ratio']:.4f}, fill ratio {r['fill_ratio']:.4%})"
        for r in memory.best_runs_for_dataset(dataset_name)
    ]

    return {
        "run_id": str(uuid.uuid4()),
        "dataset_name": dataset_name,
        "volatility_regime": volatility_regime,
        "risk_params": risk_params,
        "strategy_class_hint": "AvellanedaStoikovStrategy",
        "_pending_code": None,
        "audit_passed": False,
        "audit_findings": [],
        "status": "",
        "metrics": {},
        "traceback": "",
        "attempt": 0,
        "max_attempts": MAX_ATTEMPTS,
        "benchmark_sharpe": benchmark_sharpe,
        "feedback": "",
        "done": False,
        "approach_description": "",
        "tried_approaches": [],
        "retry_reason": "",
        "dataset_best_history": dataset_best_history,
        "validation_dataset_name": validation_dataset_name,
    }


async def run_pipeline(
    dataset_name: str = DATASET_NAME, calibration_ticks_file: str = CALIBRATION_TICKS_FILE
) -> dict[str, Any]:
    llm = build_llm()
    mcp_tools = await connect_mcp_tools()

    with MemoryManager() as memory:
        initial_state = await build_initial_state(mcp_tools, memory, dataset_name, calibration_ticks_file)
        graph = build_graph(llm, mcp_tools, memory)
        final_state = await graph.ainvoke(initial_state, config={"recursion_limit": MAX_ATTEMPTS * 6 + 10})

    logger.info(
        "Pipeline finished for run %s after %d attempt(s): status=%s",
        final_state["run_id"], final_state["attempt"], final_state["status"],
    )
    return final_state


async def main() -> None:
    result = await run_pipeline()
    print(json.dumps({k: v for k, v in result.items() if k != "_pending_code"}, default=str))


if __name__ == "__main__":
    asyncio.run(main())
