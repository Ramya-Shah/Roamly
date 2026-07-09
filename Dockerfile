# =============================================================================
# Project Alpha-Forge - single-image deployment build
#
# Collapses the four docker-compose services (sandbox_execution, dashboard_api,
# dashboard_ui, and the CLI orchestrator's logic) into ONE self-contained
# linux/amd64 image that the hackathon harness can run standalone with no bind
# mounts and no external env injection:
#
#   nginx :9080  -> serves the React SPA and reverse-proxies /api/ to
#   uvicorn :8090 (FastAPI backend) -> talks over SSE to
#   mcp_server :8000 (FastMCP tool server, internal only)
#
# Real historical market data and all configuration are baked in, so the
# container is fully self-sufficient the moment it starts.
# =============================================================================

# ---- Stage 1: build the React frontend -------------------------------------
FROM node:20-slim AS frontend-build
WORKDIR /app
# NOTE: if you build behind a corporate TLS-inspection proxy, npm may need
# that proxy's CA trusted here (COPY it in + set NODE_EXTRA_CA_CERTS) - not
# needed on an unintercepted personal network/PC, so omitted by default.
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: runtime (python + nginx + the three processes) ---------------
FROM python:3.11-slim-bookworm
WORKDIR /app

# Toolchain for numba/hftbacktest native bits, plus nginx to serve the SPA.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential cmake gcc g++ git nginx ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# NOTE: if you run this behind a corporate TLS-inspection proxy, that proxy's
# CA needs trusting here (COPY it in + update-ca-certificates) for outbound
# calls to the LLM gateway to verify - not needed on an unintercepted personal
# network/PC, so omitted by default.

RUN pip install --no-cache-dir \
        numpy pandas numba hftbacktest mcp fastmcp pybind11 \
        fastapi "uvicorn[standard]" sse-starlette \
        langgraph langchain langchain-mcp-adapters langchain-openai langchain-anthropic \
        duckdb

# Application code (all six modules share one filesystem now).
COPY mcp_server.py strategy_templates.py backtest_runner.py \
     memory_manager.py orchestrator.py api_server.py ./

# Real historical market data, baked in (no bind mount at runtime).
COPY historical_data/ /app/data/

# Built SPA + single-image nginx config.
COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY nginx.single.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/sites-enabled/default

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && mkdir -p /app/db /app/sandbox_workspace

# --- Baked-in configuration --------------------------------------------------
# All three processes live in one container, so MCP is reached over loopback.
ENV MCP_SERVER_URL=http://localhost:8000/sse \
    SANDBOX_WORKSPACE_DIR=/app/sandbox_workspace \
    HISTORICAL_DATA_DIR=/app/data \
    MEMORY_DB_PATH=/app/db/alpha_forge.duckdb \
    LOG_LEVEL=INFO \
    BACKTEST_TIMEOUT_SECONDS=120 \
    LLM_PROVIDER=openai \
    LLM_MODEL=gpt-5.5 \
    OPENAI_API_BASE=https://gateway-buildathon.ltl.sh/v1 \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    DATASET_NAME=suiusdt_real_replay.npz \
    CALIBRATION_TICKS_FILE=suiusdt_real_calibration.npz \
    VALIDATION_DATASET_NAME=suiusdt_oos_replay.npz \
    OOS_MIN_RETENTION_RATIO=0.5 \
    FALLBACK_T=3600 \
    MAX_ATTEMPTS=6

# LLM gateway key: baked into the image deliberately (accepted risk - this
# deploy target injects no runtime env), but supplied as a build-arg rather
# than a literal, so the real value lives only in .env (gitignored), never in
# this committed file. Build with:
#   docker build --build-arg OPENAI_API_KEY=$(grep -oP '(?<=^OPENAI_API_KEY=).*' .env) -t alpha-forge .
ARG OPENAI_API_KEY
ENV OPENAI_API_KEY=${OPENAI_API_KEY}

EXPOSE 9080 8090
ENTRYPOINT ["/app/docker-entrypoint.sh"]
