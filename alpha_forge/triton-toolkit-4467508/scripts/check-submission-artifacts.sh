#!/bin/bash
# Verify a task's submission-time artifacts are present and meaningful.
#
# Run before packaging the tarball. Blocks the submission if any of these are
# missing or look suspicious:
#
#   - .rubric-review.md present (worker ran check-quality.sh at least once)
#   - latest harbor-jobs/trial-<task>-* exists with a trial-analysis.md
#     (worker ran trial.sh)
#   - latest harbor-jobs/cheat-trial-<task>-* exists with a trial-analysis.md
#     (worker ran cheat-trial.sh)
#   - the regular and cheat trial-analysis.md files are NOT byte-identical
#     (catches the pre-3935d3b mtime-bundling bug pattern where workers
#     shipped one file labeled as the other)
#
# Usage: scripts/check-submission-artifacts.sh <task-path>
# Exits 0 if all artifacts present and distinct; 1 otherwise.

# Use -u and -o pipefail but not -e — the script tracks failures explicitly
# via FAIL and a final aggregate exit. Avoids a bash-3.2 macOS quirk where
# `var=$(pipeline | with | several | stages)` aborts the script on empty
# pipeline output even when each stage individually returns 0.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLKIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HARBOR_JOBS_DIR="$TOOLKIT_ROOT/harbor-jobs"
TIMESTAMP_GLOB='[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]'

if [ $# -lt 1 ]; then
    echo "Usage: $0 <task-path>" >&2
    exit 2
fi

TASK_PATH="$1"

if [ ! -d "$TASK_PATH" ]; then
    echo "ERROR: task directory not found: $TASK_PATH" >&2
    exit 2
fi

TASK_ABS="$(cd "$TASK_PATH" && pwd)"
TASK_NAME="$(basename "$TASK_ABS")"

# Resolve the latest trial-analysis.md for a given prefix.
# Trial dirs are named harbor-jobs/<prefix>-<task>-YYYYMMDD-HHMMSS, so
# alphabetical sort = chronological. The timestamp-shaped suffix avoids
# accidentally treating trial-foo-bar-* as an artifact for task foo.
#
# Args:
#   $1 — prefix to match ("trial" or "cheat-trial")
# Echoes the absolute path to the newest matching trial-analysis.md, or empty.
latest_trial_analysis() {
    local prefix="$1"
    local latest=""
    if [ ! -d "$HARBOR_JOBS_DIR" ]; then
        echo ""
        return 0
    fi
    # Bash globs sort alphabetically by default; with timestamped names
    # this matches chronological order.
    for d in "$HARBOR_JOBS_DIR/${prefix}-${TASK_NAME}-"$TIMESTAMP_GLOB/; do
        # Guard against the no-match case where the literal pattern is left.
        # Strip the trailing slash that bash's */ glob always appends.
        local clean="${d%/}"
        if [ -d "$clean" ] && [ -f "$clean/trial-analysis.md" ]; then
            latest="$clean/trial-analysis.md"
        fi
    done
    echo "$latest"
}

FAIL=0

# --- Rubric review ---
if [ ! -f "$TASK_ABS/.rubric-review.md" ]; then
    echo "MISSING: $TASK_PATH/.rubric-review.md" >&2
    echo "  Run: scripts/check-quality.sh $TASK_PATH" >&2
    FAIL=1
fi

# --- Latest regular trial ---
LATEST_REGULAR="$(latest_trial_analysis trial)"
if [ -z "$LATEST_REGULAR" ]; then
    echo "MISSING: latest harbor-jobs/trial-${TASK_NAME}-*/trial-analysis.md" >&2
    echo "  Run: scripts/trial.sh $TASK_PATH" >&2
    FAIL=1
fi

# --- Latest cheat trial ---
LATEST_CHEAT="$(latest_trial_analysis cheat-trial)"
if [ -z "$LATEST_CHEAT" ]; then
    echo "MISSING: latest harbor-jobs/cheat-trial-${TASK_NAME}-*/trial-analysis.md" >&2
    echo "  Run: scripts/cheat-trial.sh $TASK_PATH" >&2
    FAIL=1
fi

# --- Regular and cheat must be distinct ---
# Pre-3935d3b workers occasionally shipped one trial type labeled as the
# other due to mtime-based bundling. Byte-identical regular and cheat
# analyses is a strong signal that something was mislabeled at packaging.
if [ -n "$LATEST_REGULAR" ] && [ -n "$LATEST_CHEAT" ]; then
    if cmp -s "$LATEST_REGULAR" "$LATEST_CHEAT"; then
        echo "MISLABEL: regular and cheat trial-analysis.md are byte-identical." >&2
        echo "  Regular: $LATEST_REGULAR" >&2
        echo "  Cheat:   $LATEST_CHEAT" >&2
        echo "  This usually means one was bundled in place of the other." >&2
        echo "  Re-run scripts/trial.sh and scripts/cheat-trial.sh, then resubmit." >&2
        FAIL=1
    fi
fi

if [ "$FAIL" -ne 0 ]; then
    exit 1
fi

exit 0
