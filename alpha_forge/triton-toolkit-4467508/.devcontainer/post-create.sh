#!/bin/bash
# Post-create setup for the task-authoring devcontainer.
set -euo pipefail

git config --global --add safe.directory '*'

# Auto-source .env on every interactive shell so scripts can see the API key.
cat >> ~/.bashrc <<'BASHRC'

# Auto-load .env if present
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

# Keep interactive Claude Code authoring aligned with trial.sh defaults.
export CLAUDE_CODE_MAX_OUTPUT_TOKENS="${CLAUDE_CODE_MAX_OUTPUT_TOKENS:-128000}"

# Pin the authoring CC session to Opus 4.8 + max reasoning effort, and skip
# per-tool permission prompts so the worker isn't interrupted on every
# Read/Write/Bash call.
alias claude="claude --model claude-opus-4-8 --effort max --dangerously-skip-permissions"

# Prompt marker for worker context
export PS1="\[\033[1;33m\][task-authoring]\[\033[0m\] \w\$ "
BASHRC

echo "Dev container ready."
echo ""
echo "  Docker client: $(docker --version 2>/dev/null || echo 'NOT FOUND')"
echo "  Harbor:        $(harbor --version 2>/dev/null || echo 'NOT FOUND')"
echo "  uv:            $(uv --version 2>/dev/null || echo 'NOT FOUND')"
echo ""
echo "If .env is missing, copy .env.example to .env and set ANTHROPIC_API_KEY."
