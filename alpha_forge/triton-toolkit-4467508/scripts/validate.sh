#!/bin/bash
# Validate a task: oracle must pass, nop must fail, static checks must pass.
#
# Usage: scripts/validate.sh <task-path>
# Example: scripts/validate.sh tasks/compile-postgres-with-sanitizers

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLKIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CI_CHECKS_DIR="$TOOLKIT_ROOT/refs/ci_checks"
source "$SCRIPT_DIR/lib/toolkit-env.sh"

# Harbor must run with CWD = the host-visible workspace path so its nested
# container mounts resolve against the host Docker daemon.
HARBOR_CWD="${HOST_WORKSPACE:-$TOOLKIT_ROOT}"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <task-path>" >&2
    exit 1
fi

TASK_PATH="$1"

if [ ! -d "$TASK_PATH" ]; then
    echo "ERROR: task directory not found: $TASK_PATH" >&2
    exit 1
fi

require_toolkit_command harbor "validate.sh uses Harbor for the oracle and nop runs."

# Load .env if present (for API keys Harbor may need).
if [ -f "$TOOLKIT_ROOT/.env" ]; then
    set -a
    source "$TOOLKIT_ROOT/.env"
    set +a
fi

# Namespace Harbor output for clean.sh to pattern-match it per task.
# All oracle+nop runs from this invocation land under validate-<task>-<ts>/.
TASK_NAME="$(basename "$TASK_PATH")"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
VALIDATE_DIR="harbor-jobs/validate-${TASK_NAME}-${TIMESTAMP}"

FAIL_COUNT=0

# subrun_from_capture <harbor-capture-file>
#
# Harbor prints "Results written to harbor-jobs/<job>/<subrun>/result.json".
# Extract the full result.json path and strip the filename. Keep backticks and
# terminal punctuation out of the match; older parsing accidentally included
# formatting backticks and then pointed workers at bogus `...`/job.log paths.
subrun_from_capture() {
    local capture="$1"
    local result_path
    result_path=$(awk '
        match($0, /harbor-jobs\/[^[:space:]`]+\/[^[:space:]`]+\/result\.json/) {
            print substr($0, RSTART, RLENGTH)
        }
    ' "$capture" 2>/dev/null | tail -n 1 || true)

    if [ -n "$result_path" ]; then
        echo "${result_path%/result.json}"
        return 0
    fi

    # Last-ditch fallback: if the result line was absent or reformatted, pick
    # the newest top-level result.json under this validate invocation.
    if [ -d "$TOOLKIT_ROOT/$VALIDATE_DIR" ]; then
        result_path=$(find "$TOOLKIT_ROOT/$VALIDATE_DIR" -mindepth 2 -maxdepth 2 -type f -name result.json 2>/dev/null | sort | tail -n 1 || true)
        if [ -n "$result_path" ]; then
            result_path="${result_path#$TOOLKIT_ROOT/}"
            echo "${result_path%/result.json}"
            return 0
        fi
    fi

    echo ""
}

resolve_harbor_path() {
    local rel="$1"
    if [ -e "$TOOLKIT_ROOT/$rel" ]; then
        echo "$TOOLKIT_ROOT/$rel"
    elif [ -e "$HARBOR_CWD/$rel" ]; then
        echo "$HARBOR_CWD/$rel"
    else
        echo "$TOOLKIT_ROOT/$rel"
    fi
}

print_common_harbor_diagnostics() {
    local capture="$1"
    local job_log="$2"
    local combined
    combined=$(mktemp)
    cat "$capture" > "$combined" 2>/dev/null || true
    if [ -n "$job_log" ] && [ -f "$job_log" ]; then
        cat "$job_log" >> "$combined" 2>/dev/null || true
    fi

    if grep -qiE 'Docker daemon is not running|Cannot connect to the Docker daemon|docker: Cannot connect' "$combined"; then
        echo "   Diagnosis: Docker daemon is unavailable. Start Docker Desktop / dockerd, confirm \`docker ps\` works inside the dev container, then rerun validate."
    elif grep -qiE 'Skipping image OS validation|docker inspect returned 1|No such image|pull access denied|failed to solve|failed to build|docker build' "$combined"; then
        echo "   Diagnosis: Harbor could not build or inspect the task image. The first Docker/Dockerfile error is usually in job.log above."
        echo "   Check for missing COPY sources, failed package installs, removed images, or a Docker daemon restart, then rerun validate."
    fi

    rm -f "$combined"
}

# dump_failure_logs <harbor-capture-file> <role>
#
# When oracle or nop fails, the real error (pytest assertion, Docker build
# failure, ModuleNotFoundError at collection) lives under
# harbor-jobs/<job>/<subrun>/. Parse the subrun path from Harbor output and
# tail the files that usually hold the cause.
dump_failure_logs() {
    local capture="$1"
    local role="$2"

    local subrun
    subrun=$(subrun_from_capture "$capture")

    if [ -z "$subrun" ]; then
        echo "   (could not locate Harbor subrun path in captured output — logs unavailable)"
        print_common_harbor_diagnostics "$capture" ""
        return 0
    fi

    local subrun_path
    subrun_path=$(resolve_harbor_path "$subrun")
    local job_log_path="$subrun_path/job.log"

    echo ""
    echo "   --- $subrun/job.log (last 30 lines) ---"
    if [ -f "$job_log_path" ]; then
        tail -n 30 "$job_log_path" 2>/dev/null | sed 's/^/      /' || true
    else
        echo "      (job.log not found at $job_log_path)"
        echo "      Try: harbor view $VALIDATE_DIR"
    fi
    print_common_harbor_diagnostics "$capture" "$job_log_path"

    local verifier_log
    verifier_log=$(find "$subrun_path" -type f -path '*/verifier/test-stdout.txt' 2>/dev/null | head -n 1 || true)
    echo ""
    if [ -n "$verifier_log" ] && [ -f "$verifier_log" ]; then
        echo "   --- ${verifier_log#$TOOLKIT_ROOT/} (last 40 lines) ---"
        tail -n 40 "$verifier_log" 2>/dev/null | sed 's/^/      /' || true
    else
        echo "   --- verifier/test-stdout.txt ---"
        echo "      (no verifier output — likely an environment/build failure; see job.log above)"
        echo "      If job.log shows Docker/image setup failure, fix the Dockerfile or daemon issue first; pytest never ran."
    fi

    local agent_log
    agent_log=$(find "$subrun_path" -type f -path "*/agent/${role}.txt" 2>/dev/null | head -n 1 || true)
    echo ""
    if [ -n "$agent_log" ] && [ -f "$agent_log" ]; then
        echo "   --- ${agent_log#$TOOLKIT_ROOT/} (last 20 lines) ---"
        tail -n 20 "$agent_log" 2>/dev/null | sed 's/^/      /' || true
    else
        echo "   --- agent/${role}.txt ---"
        echo "      (no ${role} agent log found)"
    fi
    echo ""
}

echo "=========================================="
echo "VALIDATE: $TASK_PATH"
echo "=========================================="

# --- Static checks (from refs/ci_checks/) ---
echo ""
echo "[1/3] Static checks"
echo "------------------------------------------"
for check in "$CI_CHECKS_DIR"/check-*.sh; do
    check_name=$(basename "$check")
    echo ">> $check_name"
    if bash "$check" "$TASK_PATH"; then
        echo "   OK"
    else
        echo "   FAIL"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
done

# --- Oracle must pass (reward = 1.0) ---
echo ""
echo "[2/3] Oracle agent run (must produce reward = 1.0)"
echo "------------------------------------------"
ORACLE_OUTPUT=$(mktemp)
(cd "$HARBOR_CWD" && harbor run -p "$TASK_PATH" -a oracle --yes -o "$VALIDATE_DIR") 2>&1 | tee "$ORACLE_OUTPUT" || true
if grep -qE "Mean: 1\.0(00)?" "$ORACLE_OUTPUT"; then
    echo "   OK"
else
    echo "   FAIL: oracle did not achieve reward 1.0"
    dump_failure_logs "$ORACLE_OUTPUT" oracle
    FAIL_COUNT=$((FAIL_COUNT + 1))
fi
rm -f "$ORACLE_OUTPUT"

# --- Nop must fail (reward = 0.0) ---
echo ""
echo "[3/3] Nop agent run (must produce reward = 0.0)"
echo "------------------------------------------"
NOP_OUTPUT=$(mktemp)
(cd "$HARBOR_CWD" && harbor run -p "$TASK_PATH" -a nop --yes -o "$VALIDATE_DIR") 2>&1 | tee "$NOP_OUTPUT" || true
# A no-op agent should never achieve reward 1.0. We check for that negation:
# the run must have completed (no RuntimeError from an unrelated failure) AND
# mean reward must be 0.0.
if grep -qE "RuntimeError" "$NOP_OUTPUT"; then
    echo "   FAIL: nop run errored (infrastructure issue, not a test-strength issue)"
    dump_failure_logs "$NOP_OUTPUT" nop
    FAIL_COUNT=$((FAIL_COUNT + 1))
elif grep -qE "Mean: 0\.0(00)?" "$NOP_OUTPUT"; then
    echo "   OK (nop correctly received zero reward)"
else
    echo "   FAIL: nop received nonzero reward (tests may be trivially passable)"
    dump_failure_logs "$NOP_OUTPUT" nop
    FAIL_COUNT=$((FAIL_COUNT + 1))
fi
rm -f "$NOP_OUTPUT"

# --- Summary ---
echo ""
echo "=========================================="
if [ "$FAIL_COUNT" -eq 0 ]; then
    echo "VALIDATION PASSED"
    echo "=========================================="
    # Suppress the "Next:" hint when invoked as a sub-step of submit.sh's
    # tarball-verify pass — the temp task path doesn't survive submit's trap
    # cleanup and pointing the worker at it would mislead.
    if [ "${VALIDATE_DELEGATED:-}" != "1" ]; then
        echo ""
        echo "Next: scripts/check-quality.sh $TASK_PATH"
    fi
    exit 0
else
    echo "VALIDATION FAILED: $FAIL_COUNT issue(s)"
    echo "=========================================="
    exit 1
fi
