FROM node:22-bookworm

# System dependencies.
RUN apt-get update && apt-get install -y \
        git \
        python3 \
        python3-pip \
        python3-venv \
        curl \
        zip \
        unzip \
        ca-certificates \
        gnupg \
        nano \
        vim \
        less \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CE CLI + compose plugin (not docker.io from apt — that lacks compose).
# Worker's host Docker daemon is socket-mounted; we only need the client here.
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Install uv + harbor.
RUN pip3 install --break-system-packages uv \
    && uv tool install harbor

# Install Claude Code CLI (same installer Harbor's claude-code adapter uses for
# Debian-based environments — `src/harbor/agents/installed/claude_code.py:135`).
# Workers need this on PATH for `scripts/check-quality.sh` (harbor check) and
# for interactive `claude` usage during task authoring.
RUN curl -fsSL https://claude.ai/install.sh | bash

# Make uv-installed tools + claude-code on PATH for all subsequent shells.
ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /workspace
