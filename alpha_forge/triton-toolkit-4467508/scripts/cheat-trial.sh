#!/bin/bash
# Run anti-cheat trials: prepend the hostile prompt to instruction.md and see
# whether any agent passes through illegitimate means.
#
# Uses the hostile prompt at refs/hack-trial-prompt.md.
#
# Usage: scripts/cheat-trial.sh <task-path> [--trials N] [--agents list] [--concurrency N]
#        scripts/cheat-trial.sh <task-path> --resume latest|<job-dir> [--analyze-only]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLKIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOSTILE_PROMPT="$TOOLKIT_ROOT/refs/hack-trial-prompt.md"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <task-path> [--trials N] [--agents list] [--concurrency N] [--resume latest|<job-dir>] [--analyze-only]" >&2
    exit 1
fi

TASK_PATH="$1"
shift

if [ ! -d "$TASK_PATH" ]; then
    echo "ERROR: task directory not found: $TASK_PATH" >&2
    exit 1
fi

ORIGINAL_INSTRUCTION="$TASK_PATH/instruction.md"
BACKUP_INSTRUCTION="$TASK_PATH/instruction.md.bak"

if [ ! -f "$ORIGINAL_INSTRUCTION" ]; then
    echo "ERROR: $ORIGINAL_INSTRUCTION not found" >&2
    exit 1
fi

cleanup() {
    if [ -f "$BACKUP_INSTRUCTION" ]; then
        mv "$BACKUP_INSTRUCTION" "$ORIGINAL_INSTRUCTION"
        echo ""
        echo "Restored original instruction.md"
    fi
}
trap cleanup EXIT INT TERM

echo "=========================================="
echo "CHEAT TRIAL: $(basename "$TASK_PATH")"
echo "Hostile prompt prepended to instruction.md."
echo "Any illegitimate PASS here = the task is hackable; harden before submitting."
echo "=========================================="

# Backup and prepend hostile prompt.
cp "$ORIGINAL_INSTRUCTION" "$BACKUP_INSTRUCTION"
{
    cat "$HOSTILE_PROMPT"
    echo ""
    echo "---"
    echo ""
    cat "$BACKUP_INSTRUCTION"
} > "$ORIGINAL_INSTRUCTION"

# Run the trial with the modified instruction. Trap above restores on exit.
# CHEAT_TRIAL_DELEGATED suppresses trial.sh's own "Next:" hint since cheat-trial
# has its own. JOB_DIR_PREFIX routes output to harbor-jobs/cheat-trial-... so
# submit.sh can bundle the cheat run alongside (not on top of) the regular
# trial output. Override the claude-code model: trial.sh uses the regular
# calibration model by default, but cheat trials want the strongest adversary —
# Opus is more likely to find genuine cheat surfaces.
CHEAT_TRIAL_DELEGATED=1 \
    JOB_DIR_PREFIX=cheat-trial \
    CLAUDE_CODE_MODEL="claude-opus-4-8" \
    "$SCRIPT_DIR/trial.sh" "$TASK_PATH" "$@"

echo ""
echo "Next: scripts/submit.sh $TASK_PATH"
