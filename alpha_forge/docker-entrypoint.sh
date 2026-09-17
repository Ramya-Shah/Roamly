#!/usr/bin/env bash
# Single-container entrypoint for the deployed Alpha-Forge image.
#
# Runs the three processes that were separate containers under docker-compose,
# in dependency order:
#   1. mcp_server.py  (FastMCP/SSE tool server) on :8000  - internal only
#   2. uvicorn api_server:app                    on :8090  - backend, behind nginx
#   3. nginx                                     on :9080  - serves the SPA + proxies /api/
#
# The API server connects to the MCP server at startup (its lifespan hook), so
# we must wait for :8000 to accept connections before launching uvicorn, or the
# backend would crash on boot and the health check would never pass.
set -euo pipefail

log() { echo "[entrypoint] $*"; }

mkdir -p /app/db /app/sandbox_workspace

log "starting MCP sandbox server on :8000"
python mcp_server.py --transport sse --port 8000 &
MCP_PID=$!

log "waiting for MCP server to accept connections..."
for _ in $(seq 1 90); do
  if ! kill -0 "$MCP_PID" 2>/dev/null; then
    log "FATAL: MCP server exited during startup"; exit 1
  fi
  if python -c "import socket,sys; s=socket.socket(); s.settimeout(1); sys.exit(0 if s.connect_ex(('127.0.0.1',8000))==0 else 1)"; then
    log "MCP server is up"; break
  fi
  sleep 1
done

log "starting API backend (uvicorn) on :8090"
uvicorn api_server:app --host 0.0.0.0 --port 8090 &

log "starting nginx on :9080 (foreground)"
exec nginx -g 'daemon off;'
