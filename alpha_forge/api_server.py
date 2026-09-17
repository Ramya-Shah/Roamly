"""
FastAPI dashboard backend for Project Alpha-Forge.

Wraps the LangGraph pipeline defined in ``orchestrator.py`` with an HTTP API
so a browser frontend can trigger runs, watch their per-node progress live
over Server-Sent Events, browse run history from ``memory_manager``'s
DuckDB store, and view a completed run's generated strategy source.

This process owns one long-lived MCP connection, LLM client, DuckDB
connection, and compiled LangGraph graph (built once at startup and reused
across requests - a compiled graph is safe to invoke/stream concurrently
with independent state dicts). It mounts ``sandbox_workspace`` read-only
purely for the code-viewer endpoint; it never writes strategy files itself,
that stays exclusively the job of the sandbox's ``write_strategy_code`` tool.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from starlette.concurrency import run_in_threadpool

import orchestrator
from memory_manager import MemoryManager

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("alpha_forge.api_server")

SANDBOX_WORKSPACE_DIR = Path(os.environ.get("SANDBOX_WORKSPACE_DIR", "/app/sandbox_workspace")).resolve()
_SAFE_FILENAME_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_\-.]*\.py$")


class RunHandle:
    """Server-side bookkeeping for one in-flight or completed run's SSE stream."""

    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.finished = False


RUNS: dict[str, RunHandle] = {}
# Finished handles kept for late SSE reconnects; beyond this many, the oldest
# finished ones are pruned so the dict doesn't grow unboundedly over a
# long-lived server process.
MAX_RETAINED_RUNS = 50


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Connecting to MCP sandbox and building the LangGraph pipeline...")
    app.state.llm = orchestrator.build_llm()
    app.state.mcp_tools = await orchestrator.connect_mcp_tools()
    app.state.memory = MemoryManager()
    app.state.graph = orchestrator.build_graph(app.state.llm, app.state.mcp_tools, app.state.memory)
    logger.info("Dashboard API ready.")
    try:
        yield
    finally:
        app.state.memory.close()


app = FastAPI(title="Alpha-Forge Dashboard API", lifespan=lifespan)

# Permissive CORS: this is an internal research/dev dashboard behind the
# operator's own network, not a customer-facing service. Tighten this if
# that assumption ever changes.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunRequest(BaseModel):
    dataset_name: str | None = None
    calibration_ticks_file: str | None = None


def _sanitize_state(state: dict[str, Any]) -> dict[str, Any]:
    """Strip the ephemeral raw-code field before any state reaches the browser."""
    return {k: v for k, v in state.items() if k != "_pending_code"}


async def _execute_run(app: FastAPI, handle: RunHandle, request: RunRequest) -> None:
    dataset_name = request.dataset_name or orchestrator.DATASET_NAME
    calibration_ticks_file = request.calibration_ticks_file or orchestrator.CALIBRATION_TICKS_FILE

    try:
        initial_state = await orchestrator.build_initial_state(
            app.state.mcp_tools, app.state.memory, dataset_name, calibration_ticks_file
        )
        initial_state["run_id"] = handle.run_id
        merged: dict[str, Any] = dict(initial_state)
        await handle.queue.put({"type": "state", "node": "__init__", "state": _sanitize_state(merged)})

        config = {"recursion_limit": orchestrator.MAX_ATTEMPTS * 6 + 10}
        async for step in app.state.graph.astream(initial_state, stream_mode="updates", config=config):
            for node_name, partial in step.items():
                merged.update(partial)
                await handle.queue.put(
                    {"type": "state", "node": node_name, "state": _sanitize_state(merged)}
                )

        await handle.queue.put({"type": "done", "state": _sanitize_state(merged)})
    except Exception as exc:  # noqa: BLE001 - reported to the client as a run failure, not raised
        logger.exception("Run %s crashed", handle.run_id)
        await handle.queue.put({"type": "run_error", "error": str(exc)})
    finally:
        handle.finished = True


@app.post("/api/runs")
async def start_run(request: RunRequest | None = None) -> dict[str, str]:
    # One run at a time: the pipeline shares a single MemoryManager/DuckDB
    # connection and one benchmark high-water mark, and a double-clicked
    # button should not silently race two LLM loops against each other.
    active = next((h for h in RUNS.values() if not h.finished), None)
    if active is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Run {active.run_id} is still in progress; wait for it to finish.",
        )

    finished_ids = [rid for rid, h in RUNS.items() if h.finished]
    for rid in finished_ids[: max(0, len(finished_ids) - MAX_RETAINED_RUNS)]:
        del RUNS[rid]

    run_id = str(uuid.uuid4())
    handle = RunHandle(run_id)
    RUNS[run_id] = handle
    asyncio.create_task(_execute_run(app, handle, request or RunRequest()))
    return {"run_id": run_id}


@app.get("/api/runs/{run_id}/stream")
async def stream_run(run_id: str) -> EventSourceResponse:
    handle = RUNS.get(run_id)
    if handle is None:
        raise HTTPException(status_code=404, detail=f"Unknown run_id '{run_id}'")

    async def event_generator():
        # Named "run_error" rather than "error": browsers dispatch a plain
        # SSE "error" event to EventSource's own connection-level onerror
        # handler, which would collide with a genuine pipeline failure event.
        while True:
            item = await handle.queue.get()
            yield {"event": item["type"], "data": _json(item)}
            if item["type"] in ("done", "run_error"):
                return

    return EventSourceResponse(event_generator())


@app.get("/api/runs")
async def list_runs(limit: int = 200) -> list[dict[str, Any]]:
    return await run_in_threadpool(app.state.memory.list_runs, limit)


@app.get("/api/code/{filename}")
async def get_strategy_code(filename: str) -> dict[str, str]:
    if not _SAFE_FILENAME_RE.match(filename):
        raise HTTPException(status_code=400, detail="Invalid filename.")
    path = (SANDBOX_WORKSPACE_DIR / filename).resolve()
    try:
        path.relative_to(SANDBOX_WORKSPACE_DIR)
    except ValueError:
        raise HTTPException(status_code=400, detail="Path escapes the sandbox workspace.")
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"No such strategy file: {filename}")
    return {"filename": filename, "code": path.read_text(encoding="utf-8")}


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


def _json(item: dict[str, Any]) -> str:
    return json.dumps(item, default=str)
