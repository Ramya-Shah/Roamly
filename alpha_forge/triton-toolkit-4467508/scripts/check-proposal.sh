#!/bin/bash
# Run the 6-criterion task-proposal rubric review against a task's instruction.md.
#
# Scaffold first with scripts/new-task.sh, then edit tasks/<task-slug>/instruction.md
# with your task idea, then run this script against the task directory to get
# per-criterion judgements on the idea before filling in the rest of the files.
#
# Writes output to tasks/<task-slug>/.proposal-review.md and streams to stdout.
#
# Usage: scripts/check-proposal.sh <task-path> [--model <model>]
# Example: scripts/check-proposal.sh tasks/<task-slug>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLKIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUBRIC="$TOOLKIT_ROOT/refs/rubrics/task-proposal.md"
source "$SCRIPT_DIR/lib/toolkit-env.sh"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <task-path> [--model <model>]" >&2
    exit 1
fi

TASK_PATH="$1"
shift

MODEL="claude-opus-4-8"
while [ $# -gt 0 ]; do
    case "$1" in
        --model)
            MODEL="$2"
            shift 2
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

if [ ! -d "$TASK_PATH" ]; then
    echo "ERROR: task directory not found: $TASK_PATH" >&2
    exit 1
fi

TASK_ABS="$(cd "$TASK_PATH" && pwd)"
INSTRUCTION_FILE="$TASK_ABS/instruction.md"

if [ ! -f "$INSTRUCTION_FILE" ]; then
    echo "ERROR: $INSTRUCTION_FILE not found. Did you scaffold the task with scripts/new-task.sh?" >&2
    exit 1
fi

# Load .env
if [ -f "$TOOLKIT_ROOT/.env" ]; then
    set -a
    source "$TOOLKIT_ROOT/.env"
    set +a
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    echo "ERROR: ANTHROPIC_API_KEY not set. Create .env from .env.example." >&2
    exit 1
fi

require_toolkit_command claude "check-proposal.sh uses Claude Code for the proposal review."

REVIEW_FILE="$TASK_ABS/.proposal-review.md"

echo "=========================================="
echo "Proposal review: $TASK_PATH/instruction.md"
echo "Rubric: $RUBRIC"
echo "Model:  $MODEL"
echo "Effort: max"
echo "=========================================="
echo ""

RUBRIC_CONTENT="$(cat "$RUBRIC")"
INSTRUCTION_CONTENT="$(cat "$INSTRUCTION_FILE")"

{
    echo "# Proposal Review — $(basename "$TASK_ABS")"
    echo ""
    echo "**Generated:** $(date '+%Y-%m-%d %H:%M:%S %Z')"
    echo "**Model:** $MODEL"
    echo "**Effort:** max"
    echo "**Rubric:** task-proposal.md (6 criteria)"
    echo ""
    echo "---"
    echo ""
} > "$REVIEW_FILE"

claude --print \
    --model "$MODEL" \
    --effort max \
    --allowed-tools "" \
    --append-system-prompt "$RUBRIC_CONTENT" \
    "$INSTRUCTION_CONTENT" | tee -a "$REVIEW_FILE"

echo ""
echo "=========================================="
echo "Review saved to: $REVIEW_FILE"
echo "=========================================="
echo ""
echo "Next: iterate on $TASK_PATH/instruction.md until Decision is Accept,"
echo "      then fill in the other four files and run scripts/validate.sh $TASK_PATH"
