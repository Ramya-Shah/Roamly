#!/bin/bash
# Regression tests for scripts/check-trial-signal.sh.
#
# These tests build tiny fake Harbor job trees under tasks/ and harbor-jobs/,
# run the real checker, then remove only the generated fixtures.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLKIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CHECKER="$SCRIPT_DIR/check-trial-signal.sh"
REJECTER="$SCRIPT_DIR/trial-user-reject.sh"
RUN_ID="${RUN_ID:-signal-test-$$}"
CREATED_PATHS=()

cleanup() {
    local path
    for path in "${CREATED_PATHS[@]}"; do
        rm -rf "$path"
    done
}
trap cleanup EXIT

new_fixture() {
    local slug="$1"
    local prefix="$2"
    local timestamp="$3"
    local task_dir="$TOOLKIT_ROOT/tasks/$slug"
    local job_dir="$TOOLKIT_ROOT/harbor-jobs/${prefix}-${slug}-${timestamp}"

    if [ -e "$task_dir" ] || [ -e "$job_dir" ]; then
        echo "FAIL: refusing to overwrite existing fixture path for $slug" >&2
        exit 1
    fi

    mkdir -p "$task_dir" "$job_dir"
    CREATED_PATHS+=("$task_dir" "$job_dir")
}

add_trial() {
    local slug="$1"
    local prefix="$2"
    local timestamp="$3"
    local idx="$4"
    local reward="$5"
    local with_exception="$6"
    local exception_text="${7:-simulated timeout after verifier}"
    local trial_dir="$TOOLKIT_ROOT/harbor-jobs/${prefix}-${slug}-${timestamp}/run-${idx}/${slug}__${idx}"

    mkdir -p "$trial_dir/verifier"
    if [ "$reward" != "missing" ]; then
        printf '%s\n' "$reward" > "$trial_dir/verifier/reward.txt"
    fi
    if [ "$with_exception" = "yes" ]; then
        printf '%s\n' "$exception_text" > "$trial_dir/exception.txt"
    fi
}

reject_trial() {
    local slug="$1"
    local prefix="$2"
    local timestamp="$3"
    local idx="$4"
    local reason="$5"

    "$REJECTER" "$TOOLKIT_ROOT/tasks/$slug" \
        --kind "$( [ "$prefix" = "cheat-trial" ] && echo cheat || echo regular )" \
        --job "$TOOLKIT_ROOT/harbor-jobs/${prefix}-${slug}-${timestamp}" \
        --trial "${slug}__${idx}" \
        --reason "$reason" >/dev/null
}

assert_checker() {
    local slug="$1"
    local kind="$2"
    local expected_rc="$3"
    local expected_text="$4"
    local output rc

    set +e
    output="$("$CHECKER" "$TOOLKIT_ROOT/tasks/$slug" --kind "$kind" 2>&1)"
    rc=$?
    set -e

    if [ "$rc" -ne "$expected_rc" ]; then
        echo "FAIL: $slug expected rc $expected_rc, got $rc" >&2
        echo "$output" >&2
        exit 1
    fi
    case "$output" in
        *"$expected_text"*) ;;
        *)
            echo "FAIL: $slug output missing: $expected_text" >&2
            echo "$output" >&2
            exit 1
            ;;
    esac
}

if ! grep -Fxq 'CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000' "$TOOLKIT_ROOT/.env.example"; then
    echo "FAIL: .env.example must default Claude Code output tokens to 128000" >&2
    exit 1
fi

if ! grep -Fq 'export CLAUDE_CODE_MAX_OUTPUT_TOKENS="${CLAUDE_CODE_MAX_OUTPUT_TOKENS:-128000}"' "$TOOLKIT_ROOT/scripts/trial.sh"; then
    echo "FAIL: trial.sh must export a 128000 Claude Code output-token default" >&2
    exit 1
fi

# Exception + reward is substantive. This is the regression from worker reports.
slug="${RUN_ID}-rewarded"
new_fixture "$slug" trial 20990101-000001
for idx in 1 2 3 4 5; do
    add_trial "$slug" trial 20990101-000001 "$idx" 0 yes
done
assert_checker "$slug" regular 0 "Substantive runs:   5"
assert_checker "$slug" regular 0 "Exceptions w/reward: 5"

# A planning/output-ceiling failure with reward is still substantive failed-agent
# signal. Workers should not user-reject it just because no code was written.
slug="${RUN_ID}-planning-ceiling"
new_fixture "$slug" trial 20990101-000007
for idx in 1 2 3 4 5; do
    add_trial "$slug" trial 20990101-000007 "$idx" 0 yes "API Error: Claude's response exceeded the 128000 output token maximum after long planning"
done
assert_checker "$slug" regular 0 "Substantive runs:   5"
assert_checker "$slug" regular 0 "Exceptions w/reward: 5"

# Missing reward is still non-substantive and blocks submission.
slug="${RUN_ID}-missing"
new_fixture "$slug" trial 20990101-000002
for idx in 1 2 3 4; do
    add_trial "$slug" trial 20990101-000002 "$idx" 0 no
done
add_trial "$slug" trial 20990101-000002 5 missing yes
assert_checker "$slug" regular 1 "Substantive runs:   4"
assert_checker "$slug" regular 1 "Missing reward:     1"

# Regular trials still enforce the high-pass warning.
slug="${RUN_ID}-trivial"
new_fixture "$slug" trial 20990101-000003
for idx in 1 2 3 4 5; do
    add_trial "$slug" trial 20990101-000003 "$idx" 1 no
done
assert_checker "$slug" regular 2 "Pass rate:          100% (of substantive)"

# At 5 trials, 4/5 passes is already the 80% ceiling and should block.
slug="${RUN_ID}-borderline"
new_fixture "$slug" trial 20990101-000005
for idx in 1 2 3 4; do
    add_trial "$slug" trial 20990101-000005 "$idx" 1 no
done
add_trial "$slug" trial 20990101-000005 5 0 no
assert_checker "$slug" regular 2 "Pass rate:          80% (of substantive)"

# A worker-authored reject artifact for a true pre-engagement Claude Code
# wrapper/API ceiling excludes the slot without deleting it.
slug="${RUN_ID}-user-reject"
new_fixture "$slug" trial 20990101-000006
for idx in 1 2 3 4 5; do
    add_trial "$slug" trial 20990101-000006 "$idx" 0 no
done
reject_trial "$slug" trial 20990101-000006 5 "Claude's response exceeded the 128000 output token maximum before coherent task engagement"
assert_checker "$slug" regular 1 "User-rejected:     1"
assert_checker "$slug" regular 1 "Substantive runs:   4"
reject_file="$TOOLKIT_ROOT/harbor-jobs/trial-${slug}-20990101-000006/run-5/${slug}__5/.user-reject.md"
if [ ! -f "$reject_file" ]; then
    echo "FAIL: reject artifact was not written" >&2
    exit 1
fi
case "$(cat "$reject_file")" in
    *"128000 output token maximum"* ) ;;
    *)
        echo "FAIL: reject artifact missing 128000 output-ceiling reason" >&2
        cat "$reject_file" >&2
        exit 1
        ;;
esac
case "$(cat "$reject_file")" in
    *"A 32K or 64K ceiling means the current toolkit default was not applied; top up at 128K."* ) ;;
    *)
        echo "FAIL: reject artifact missing stale ceiling top-up warning" >&2
        cat "$reject_file" >&2
        exit 1
        ;;
esac
case "$(cat "$reject_file")" in
    *"long 128K planning/reasoning spirals"* ) ;;
    *)
        echo "FAIL: reject artifact missing 128K planning/reasoning warning" >&2
        cat "$reject_file" >&2
        exit 1
        ;;
esac

# Cheat trials do not enforce the high-pass gate; legit solves are reviewed by
# the reward_hacking rubric instead.
slug="${RUN_ID}-cheat-pass"
new_fixture "$slug" cheat-trial 20990101-000004
for idx in 1 2 3 4 5; do
    add_trial "$slug" cheat-trial 20990101-000004 "$idx" 1 no
done
assert_checker "$slug" cheat 0 "Pass rate:          100% (of substantive)"

echo "OK - check-trial-signal regression tests passed."
