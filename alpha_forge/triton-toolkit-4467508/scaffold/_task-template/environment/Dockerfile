# Builds the container the agent runs in. Replace the example below with the
# system packages, language toolchains, and seed data your task actually needs.
# Full guidance: docs/task-anatomy.md → environment/Dockerfile section.
#
# Don't: pin apt versions; COPY tests/ or solution/ (Harbor mounts them at
# runtime); install test-only deps here. Normal verifier deps go in
# tests/test.sh; advanced offline verifier deps go in tests/Dockerfile.

FROM ubuntu:24.04

WORKDIR /app

# REPLACE: list the packages your agent needs at runtime.
RUN apt-get update && apt-get install -y \
        curl \
    && rm -rf /var/lib/apt/lists/*

# OPTIONAL: copy seed files the agent will read at runtime.
# COPY data /app/data

# OPTIONAL: install pinned language deps (Python/Node/Rust/etc.) from a
# lockfile committed under environment/. Pinning is required by the
# `deterministic_reproducible` rubric criterion.
# COPY requirements.txt /app/
# RUN pip install --no-cache-dir -r /app/requirements.txt
