#!/bin/bash
# Create a new task directory from the scaffold template.
#
# Usage: scripts/new-task.sh <task-slug>
# Example: scripts/new-task.sh compile-postgres-with-sanitizers

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLKIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCAFFOLD="$TOOLKIT_ROOT/scaffold/_task-template"
TASKS_DIR="$TOOLKIT_ROOT/tasks"

if [ $# -ne 1 ]; then
    echo "Usage: $0 <task-slug>" >&2
    echo "  task-name must be lowercase kebab-case (e.g. debug-memory-leak)" >&2
    exit 1
fi

TASK_NAME="$1"

# Validate name: lowercase letters, digits, hyphens. Max ~5 words per rubric.
if ! [[ "$TASK_NAME" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
    echo "ERROR: task name must be lowercase kebab-case (letters, digits, hyphens)" >&2
    echo "       got: $TASK_NAME" >&2
    exit 1
fi

WORD_COUNT=$(echo "$TASK_NAME" | tr '-' '\n' | wc -l | tr -d ' ')
if [ "$WORD_COUNT" -gt 5 ]; then
    echo "ERROR: task name has $WORD_COUNT words; max is 5." >&2
    echo "       Shorten the slug before scaffolding so validation/trial paths agree." >&2
    exit 1
fi

# Harbor truncates trial subdir names to ~31 chars. scripts/trial.sh's
# trial-aggregation glob matches <slug>__* — if the slug is >= 31 chars,
# the find pattern misses every trial and the analysis step silently
# no-ops. A prior batch's `calculate-clinical-trial-safety-metrics`
# (39 chars) hit this — its trial-analysis.md was never produced, leaving
# admin review to read trajectories directly. Hard-cap at 29 to leave
# room for the __<id> suffix.
SLUG_LENGTH=${#TASK_NAME}
if [ "$SLUG_LENGTH" -ge 30 ]; then
    echo "ERROR: task slug is $SLUG_LENGTH chars; max is 29." >&2
    echo "       Harbor truncates per-trial subdir names to ~31 chars, which" >&2
    echo "       breaks the trial-analysis aggregation glob and silently drops" >&2
    echo "       every trial's data point." >&2
    echo "       Shorten the slug (drop redundant words, abbreviate) and retry." >&2
    exit 1
fi

TARGET="$TASKS_DIR/$TASK_NAME"

if [ -e "$TARGET" ]; then
    echo "ERROR: $TARGET already exists" >&2
    exit 1
fi

mkdir -p "$TASKS_DIR"
cp -R "$SCAFFOLD" "$TARGET"

echo "Created: $TARGET"
echo ""
echo "Next steps:"
echo "  1. Edit $TARGET/instruction.md — the prompt shown to the agent"
echo "  2. Edit $TARGET/environment/Dockerfile — the container the agent runs in"
echo "  3. Edit $TARGET/solution/solve.sh — the oracle reference solution"
echo "  4. Edit $TARGET/tests/test_outputs.py — the verifier"
echo "  5. Edit $TARGET/task.toml — metadata + resource config"
echo ""
echo "Then:  scripts/validate.sh tasks/$TASK_NAME"
echo "Before trials: scripts/preflight.sh tasks/$TASK_NAME"
