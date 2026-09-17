#!/bin/bash
# Walk the latest trial directory and report its signal.
#
# A submission must have at least 5 *substantive* runs. A run is substantive
# when Harbor produced verifier/reward.txt: timeouts or agent exceptions after
# verification still tell us whether the task awarded reward. Missing reward
# files do not count, since those usually mean setup failed before the task
# was meaningfully attempted. The 5-substantive bar applies to BOTH the regular trial
# (difficulty calibration) and the cheat trial (anti-cheat resistance) — both
# must clear the bar before submit.
#
# A submission whose substantive pass rate reaches 80% indicates the task
# is too easy — the trial agents breeze past every intended crux. The
# calibration band is 0-40%; 40-<80% is salvageable but borderline. (The
# pass-rate gate is enforced for the regular trial only — cheat-trial pass
# rate measures cheat resistance, not difficulty.)
#
# Usage:
#   scripts/check-trial-signal.sh <task-path> [--kind regular|cheat]
#
# Exit codes:
#   0 — signal is healthy (>= 5 substantive runs, pass rate < 80% for regular)
#   1 — fewer than 5 substantive runs (always blocks)
#   2 — pass rate >= 80% (regular trial only; caller decides whether to override)
#   3 — usage error or no trial directory found
#
# This script is read-only; it does not modify any files.

# See note in check-submission-artifacts.sh — bash 3.2 macOS combines
# `set -e` + pipefail + `$()` in a way that aborts even on benign empty
# pipelines. We track failure explicitly via exit codes.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLKIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HARBOR_JOBS_DIR="$TOOLKIT_ROOT/harbor-jobs"
TIMESTAMP_GLOB='[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]'
source "$SCRIPT_DIR/lib/trial-rejects.sh"

MIN_SUBSTANTIVE=5
TRIVIAL_THRESHOLD_PCT=80

if [ $# -lt 1 ]; then
    echo "Usage: $0 <task-path> [--kind regular|cheat]" >&2
    exit 3
fi

TASK_PATH="$1"
shift || true

KIND="regular"
while [ $# -gt 0 ]; do
    case "$1" in
        --kind)
            KIND="$2"
            shift 2
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 3
            ;;
    esac
done

case "$KIND" in
    regular) DIR_PREFIX="trial" ; LABEL="difficulty trial" ;;
    cheat)   DIR_PREFIX="cheat-trial" ; LABEL="cheat trial" ;;
    *)
        echo "ERROR: --kind must be 'regular' or 'cheat'" >&2
        exit 3
        ;;
esac

if [ ! -d "$TASK_PATH" ]; then
    echo "ERROR: task directory not found: $TASK_PATH" >&2
    exit 3
fi

TASK_NAME="$(basename "$(cd "$TASK_PATH" && pwd)")"

# Find the latest harbor-jobs/<prefix>-<task>-YYYYMMDD-HHMMSS dir. Matching
# the timestamp shape avoids prefix collisions between tasks like foo and
# foo-bar, and alphabetical glob order still matches chronological order.
LATEST_TRIAL_DIR=""
if [ -d "$HARBOR_JOBS_DIR" ]; then
    for d in "$HARBOR_JOBS_DIR/${DIR_PREFIX}-${TASK_NAME}-"$TIMESTAMP_GLOB/; do
        clean="${d%/}"
        if [ -d "$clean" ]; then
            LATEST_TRIAL_DIR="$clean"
        fi
    done
fi

if [ -z "$LATEST_TRIAL_DIR" ]; then
    echo "ERROR: no harbor-jobs/${DIR_PREFIX}-${TASK_NAME}-*/ directory found." >&2
    if [ "$KIND" = "regular" ]; then
        echo "       Run scripts/trial.sh $TASK_PATH first." >&2
    else
        echo "       Run scripts/cheat-trial.sh $TASK_PATH first." >&2
    fi
    exit 3
fi

# Walk trial children. trial.sh / cheat-trial.sh launch harbor with -k N,
# which produces a nested layout: <prefix>-<task>-<ts>/<harbor-subrun>/<task>__<id>/.
# Each child contains agent/, verifier/, trial.log, and (on infrastructure
# failure) exception.txt. Top-up runs add additional sub-trial children
# under the same job dir (see trial.sh's top-up loop), so this walk picks
# them up automatically.
total=0
missing_reward=0
exceptions_with_reward=0
user_rejected=0
substantive=0
passes=0

for trial in "$LATEST_TRIAL_DIR"/*/"${TASK_NAME}__"*/; do
    clean="${trial%/}"
    [ -d "$clean" ] || continue
    total=$((total + 1))
    if trial_reject_excludes_substantive "$clean"; then
        user_rejected=$((user_rejected + 1))
        continue
    fi
    if [ ! -f "$clean/verifier/reward.txt" ]; then
        # Missing reward is treated as a setup-time failure — not substantive.
        missing_reward=$((missing_reward + 1))
        continue
    fi
    if [ -f "$clean/exception.txt" ]; then
        exceptions_with_reward=$((exceptions_with_reward + 1))
    fi
    substantive=$((substantive + 1))
    # Reward files contain a single float, sometimes with trailing whitespace.
    reward=$(tr -d '[:space:]' < "$clean/verifier/reward.txt")
    # awk handles "1.0", "1.000", "1" uniformly. exit 0 = pass.
    if awk -v r="$reward" 'BEGIN { exit (r + 0 >= 1.0) ? 0 : 1 }'; then
        passes=$((passes + 1))
    fi
done

if [ "$substantive" -gt 0 ]; then
    pass_pct=$((passes * 100 / substantive))
else
    pass_pct=0
fi

echo "${LABEL} signal — $TASK_NAME"
echo "  Source:             $LATEST_TRIAL_DIR"
echo "  Total trials:       $total"
echo "  User-rejected:     $user_rejected"
echo "  Missing reward:     $missing_reward"
echo "  Exceptions w/reward: $exceptions_with_reward"
echo "  Substantive runs:   $substantive"
echo "  Passes (reward 1.0): $passes"
echo "  Pass rate:          ${pass_pct}% (of substantive)"

if [ "$substantive" -lt "$MIN_SUBSTANTIVE" ]; then
    echo "" >&2
    echo "BLOCK: only $substantive substantive ${LABEL} runs — minimum is $MIN_SUBSTANTIVE." >&2
    echo "  Runs without verifier/reward.txt and user-rejected infra/tooling artifacts don't count;" >&2
    echo "  exceptions with reward do count." >&2
    if [ "$KIND" = "regular" ]; then
        echo "  Re-run scripts/trial.sh to top up; it will auto-retry until 5 substantive runs." >&2
    else
        echo "  Re-run scripts/cheat-trial.sh to top up; it will auto-retry until 5 substantive runs." >&2
    fi
    exit 1
fi

# Pass-rate gate applies to the regular trial only. The cheat trial's pass
# rate measures cheat resistance — what we care about there is whether any
# trial achieved reward 1.0 via illegitimate means, which is judged by the
# trial-analysis rubric, not by this script.
if [ "$KIND" = "regular" ] && [ "$pass_pct" -ge "$TRIVIAL_THRESHOLD_PCT" ]; then
    echo "" >&2
    echo "WARNING: pass rate ${pass_pct}% reaches the ${TRIVIAL_THRESHOLD_PCT}% ceiling — task may be too easy." >&2
    echo "  Target calibration band is 0-40% pass (most trials should fail on the" >&2
    echo "  intended difficulty crux). At ${pass_pct}%, trial agents breeze past every" >&2
    echo "  challenge — admin review is likely to bucket the task as 'reject (truly trivial)'." >&2
    echo "  Hardening moves: deepen the difficulty surface, add invariants the agent must" >&2
    echo "  preserve, layer additional edge cases the natural reading misses." >&2
    exit 2
fi

exit 0
