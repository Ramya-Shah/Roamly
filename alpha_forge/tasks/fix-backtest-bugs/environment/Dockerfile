# fix-backtest-bugs — agent environment
#
# Provides the buggy Alpha-Forge backtest engine plus the historical dataset
# and strategy library the agent needs to reproduce symptoms and apply fixes.

FROM python:3.11-slim-bookworm

WORKDIR /app

# Build toolchain required by numba and hftbacktest native extensions.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        gcc \
        g++ \
    && rm -rf /var/lib/apt/lists/*

# Pinned versions: bumping any of these without re-validating may break the
# hftbacktest replay API used by backtest_runner.py.
RUN pip install --no-cache-dir \
        numpy==1.26.4 \
        numba==0.59.1 \
        hftbacktest==2.2.0 \
        pandas==2.2.2 \
        pytest==8.2.2 \
        pytest-json-ctrf==0.3.5

# Project source files the agent will read and edit.
COPY app/backtest_runner.py    /app/backtest_runner.py
COPY app/strategy_templates.py /app/strategy_templates.py

# Historical replay data (read-only at runtime).
COPY app/historical_data/suiusdt_real_replay.npz \
     /app/historical_data/suiusdt_real_replay.npz
COPY app/historical_data/sample_replay.npz \
     /app/historical_data/sample_replay.npz
