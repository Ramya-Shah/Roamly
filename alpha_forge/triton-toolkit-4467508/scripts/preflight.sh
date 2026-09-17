#!/bin/bash
# Fast readiness checks before validate/trial. This is intentionally not a
# substitute for validate.sh; it catches common local setup problems early.
#
# Usage: scripts/preflight.sh [task-path]
# Example: scripts/preflight.sh tasks/<task-slug>

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLKIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

FAIL_COUNT=0
WARN_COUNT=0
PASS_COUNT=0

TASK_PATH="${1:-}"
if [ $# -gt 1 ]; then
    echo "Usage: $0 [task-path]" >&2
    exit 2
fi

pass() {
    PASS_COUNT=$((PASS_COUNT + 1))
    echo -e "${GREEN}PASS${NC} $1"
}

warn() {
    WARN_COUNT=$((WARN_COUNT + 1))
    echo -e "${YELLOW}WARN${NC} $1"
}

fail() {
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo -e "${RED}FAIL${NC} $1"
}

info() {
    echo -e "${BLUE}INFO${NC} $1"
}

indent_output() {
    sed 's/^/      /'
}

run_with_timeout() {
    local seconds="$1"
    shift

    if command -v timeout >/dev/null 2>&1; then
        timeout "$seconds" "$@"
    else
        "$@"
    fi
}

load_env() {
    if [ -f "$TOOLKIT_ROOT/.env" ]; then
        local rc=0

        (set -au; source "$TOOLKIT_ROOT/.env") >/dev/null 2>&1 || rc=$?
        if [ "$rc" -ne 0 ]; then
            fail ".env could not be loaded (exit $rc). Check it for shell syntax errors or unset variable references."
            return
        fi

        set -a
        # shellcheck disable=SC1091
        source "$TOOLKIT_ROOT/.env"
        set +a
        pass "Loaded .env"
    else
        if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
            warn ".env not found, but ANTHROPIC_API_KEY is already present in the shell"
        else
            warn ".env not found; copy .env.example to .env and fill in ANTHROPIC_API_KEY"
        fi
    fi
}

check_required_command() {
    local command_name="$1"
    local purpose="$2"
    local version_args="${3:---version}"

    if ! command -v "$command_name" >/dev/null 2>&1; then
        fail "$command_name not found ($purpose). Enter the toolkit dev container, then rerun preflight."
        return 1
    fi

    local version_output
    version_output="$(run_with_timeout 8 "$command_name" $version_args 2>&1 | head -n 1 || true)"
    if [ -n "$version_output" ]; then
        pass "$command_name found: $version_output"
    else
        pass "$command_name found"
    fi
    return 0
}

version_at_least() {
    local found="$1"
    local required="$2"
    local f_major f_minor f_patch r_major r_minor r_patch

    IFS=. read -r f_major f_minor f_patch _ <<< "$found"
    IFS=. read -r r_major r_minor r_patch _ <<< "$required"

    for value in "$f_major" "$f_minor" "$f_patch" "$r_major" "$r_minor" "$r_patch"; do
        if ! echo "$value" | grep -Eq '^[0-9]+$'; then
            return 1
        fi
    done

    if [ "$f_major" -gt "$r_major" ]; then return 0; fi
    if [ "$f_major" -lt "$r_major" ]; then return 1; fi
    if [ "$f_minor" -gt "$r_minor" ]; then return 0; fi
    if [ "$f_minor" -lt "$r_minor" ]; then return 1; fi
    [ "$f_patch" -ge "$r_patch" ]
}

check_claude_code_version_floor() {
    local min_version="2.1.197"
    local version_output version

    if ! command -v claude >/dev/null 2>&1; then
        return
    fi

    version_output="$(run_with_timeout 8 claude --version 2>&1 | head -n 1 || true)"
    version="$(printf '%s\n' "$version_output" | grep -Eo '[0-9]+([.][0-9]+){2}' | head -n 1 || true)"

    if [ -z "$version" ]; then
        warn "Could not parse Claude Code version from: ${version_output:-<empty>}"
    elif version_at_least "$version" "$min_version"; then
        pass "Claude Code version $version supports current toolkit model defaults"
    else
        fail "Claude Code version $version is older than $min_version. Rebuild the dev container or run 'claude update', then rerun preflight."
    fi
}

check_docker() {
    echo ""
    echo "Docker"
    echo "------"

    if ! command -v docker >/dev/null 2>&1; then
        fail "docker command not found. Enter the toolkit dev container or fix Docker CLI setup."
        return
    fi
    pass "docker command found"

    if run_with_timeout 12 docker ps >/dev/null 2>&1; then
        pass "Docker daemon responds to docker ps"
    else
        fail "Docker daemon is unavailable or docker ps hung. Start Docker Desktop / dockerd and confirm docker ps works."
        return
    fi

    local docker_cpus=""
    local docker_mem_bytes=""
    docker_cpus="$(docker info --format '{{.NCPU}}' 2>/dev/null || true)"
    docker_mem_bytes="$(docker info --format '{{.MemTotal}}' 2>/dev/null || true)"

    if [ -n "$docker_cpus" ] && [ "$docker_cpus" -gt 0 ] 2>/dev/null; then
        pass "Docker reports $docker_cpus CPU(s)"
    else
        warn "Could not read Docker CPU allocation"
    fi

    if [ -n "$docker_mem_bytes" ] && [ "$docker_mem_bytes" -gt 0 ] 2>/dev/null; then
        local docker_mem_gb
        docker_mem_gb=$(( (docker_mem_bytes + 1073741823) / 1073741824 ))
        pass "Docker reports about ${docker_mem_gb}GB memory"
    else
        warn "Could not read Docker memory allocation"
    fi

    local free_kb=""
    local free_gb=0
    free_kb="$(df -Pk "$TOOLKIT_ROOT" 2>/dev/null | awk 'NR == 2 { print $4 }' || true)"
    if [ -n "$free_kb" ] && [ "$free_kb" -gt 0 ] 2>/dev/null; then
        free_gb=$(( free_kb / 1024 / 1024 ))
        if [ "$free_gb" -lt 5 ]; then
            fail "Only ${free_gb}GB free near the toolkit workspace; Docker builds and Harbor jobs may fail. Free disk space before trialing."
        elif [ "$free_gb" -lt 15 ]; then
            warn "Only ${free_gb}GB free near the toolkit workspace. Clean old harbor-jobs/Docker artifacts if trials fail."
        else
            pass "${free_gb}GB free near the toolkit workspace"
        fi
    else
        warn "Could not read free disk space near the toolkit workspace"
    fi

    if [ -n "$docker_cpus" ] && [ "$docker_cpus" -lt 4 ] 2>/dev/null; then
        warn "Docker has fewer than 4 CPUs; use scripts/trial.sh ... --concurrency 1 on this machine."
    elif [ -n "$docker_mem_bytes" ] && [ "$docker_mem_bytes" -lt 12884901888 ] 2>/dev/null; then
        warn "Docker has under 12GB memory; use scripts/trial.sh ... --concurrency 1 if installs or trials stall/OOM."
    else
        pass "Default trial concurrency 3 looks reasonable for the reported Docker resources"
    fi
}

check_tools() {
    echo ""
    echo "Toolkit Commands"
    echo "----------------"

    check_required_command harbor "validate/trial/submit use Harbor" "--version"
    if check_required_command claude "quality checks and trial analysis use Claude Code" "--version"; then
        check_claude_code_version_floor
    fi
}

check_env_and_credentials() {
    echo ""
    echo "Credentials And Trial Defaults"
    echo "------------------------------"

    load_env

    if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
        pass "ANTHROPIC_API_KEY is set"
    else
        fail "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in."
    fi

    if [ -n "${OPENAI_API_KEY:-}" ]; then
        pass "OPENAI_API_KEY is set; codex trials can be included"
    else
        warn "OPENAI_API_KEY is not set; trial.sh will skip codex unless explicitly requested"
    fi

    if [ -n "${GEMINI_API_KEY:-}" ]; then
        pass "GEMINI_API_KEY is set; terminus-2 trials can be included"
    else
        warn "GEMINI_API_KEY is not set; trial.sh will skip terminus-2 unless explicitly requested"
    fi

    local base_url="${ANTHROPIC_BASE_URL:-}"
    if [ -z "$base_url" ]; then
        warn "ANTHROPIC_BASE_URL is not set. Use .env.example's app-llmproxy URL unless you intentionally use a direct Anthropic key."
    elif echo "$base_url" | grep -Eq '^https://app\.(dataannotation\.tech|surgehq\.ai)/api/llm_proxy'; then
        warn "ANTHROPIC_BASE_URL uses the old app.* LLM proxy domain. Replace app. with app-llmproxy."
    elif echo "$base_url" | grep -Eq '^https://app-llmproxy\.(dataannotation\.tech|surgehq\.ai)/api/llm_proxy'; then
        pass "ANTHROPIC_BASE_URL uses the app-llmproxy domain"
    else
        warn "ANTHROPIC_BASE_URL is set to a non-standard URL: $base_url"
    fi

    local tokens="${CLAUDE_CODE_MAX_OUTPUT_TOKENS:-}"
    if [ -z "$tokens" ]; then
        if grep -Fq 'CLAUDE_CODE_MAX_OUTPUT_TOKENS:-128000' "$TOOLKIT_ROOT/scripts/trial.sh"; then
            pass "CLAUDE_CODE_MAX_OUTPUT_TOKENS is unset; trial.sh will default Claude Code trials to 128000"
        else
            fail "CLAUDE_CODE_MAX_OUTPUT_TOKENS is unset and this trial.sh does not appear to default to 128000"
        fi
    elif ! echo "$tokens" | grep -Eq '^[0-9]+$'; then
        fail "CLAUDE_CODE_MAX_OUTPUT_TOKENS must be numeric, got: $tokens"
    elif [ "$tokens" -ne 128000 ]; then
        fail "CLAUDE_CODE_MAX_OUTPUT_TOKENS is $tokens; set it to 128000 for current regular/cheat trials"
    else
        pass "CLAUDE_CODE_MAX_OUTPUT_TOKENS is 128000"
    fi
}

check_network_target() {
    local label="$1"
    local url="$2"
    local severity="$3"

    if run_with_timeout 10 curl -L -I -sS --connect-timeout 4 --max-time 8 -o /dev/null "$url" >/dev/null 2>&1; then
        pass "$label reachable"
    else
        if [ "$severity" = "fail" ]; then
            fail "$label not reachable: $url"
        else
            warn "$label not reachable: $url"
        fi
    fi
}

check_network() {
    echo ""
    echo "Network Reachability"
    echo "--------------------"

    if ! command -v curl >/dev/null 2>&1; then
        warn "curl not found; skipping targeted network checks"
        return
    fi

    local proxy_url="${ANTHROPIC_BASE_URL:-https://app-llmproxy.dataannotation.tech/api/llm_proxy/anthropic}"
    check_network_target "LLM proxy host" "$proxy_url" "fail"
    check_network_target "Claude install host" "https://claude.ai/" "fail"
    check_network_target "Claude download host" "https://downloads.claude.ai/" "fail"
    check_network_target "Debian apt mirror" "https://deb.debian.org/debian/" "fail"
    check_network_target "uv installer host" "https://astral.sh/" "warn"
    check_network_target "Python package index" "https://pypi.org/simple/" "warn"
    check_network_target "npm registry" "https://registry.npmjs.org/" "warn"
}

run_task_check() {
    local label="$1"
    local check="$2"
    local task_path="$3"
    local output
    output="$(mktemp)"

    if bash "$check" "$task_path" >"$output" 2>&1; then
        pass "$label passed"
    else
        fail "$label failed"
        indent_output < "$output"
    fi
    rm -f "$output"
}

check_task_static() {
    echo ""
    echo "Task-Specific Static Preflight"
    echo "------------------------------"

    if [ -z "$TASK_PATH" ]; then
        info "No task path supplied; skipping task-specific checks"
        info "Run scripts/preflight.sh tasks/<task-slug> before trialing a task"
        return
    fi

    if [ ! -d "$TASK_PATH" ]; then
        fail "Task directory not found: $TASK_PATH"
        return
    fi
    pass "Task directory exists: $TASK_PATH"

    run_task_check "Task identity" "$TOOLKIT_ROOT/refs/ci_checks/check-task-identity.sh" "$TASK_PATH"
    run_task_check "Internet policy" "$TOOLKIT_ROOT/refs/ci_checks/check-internet-policy.sh" "$TASK_PATH"
    run_task_check "Dockerfile references" "$TOOLKIT_ROOT/refs/ci_checks/check-dockerfile-references.sh" "$TASK_PATH"
}

echo "=========================================="
echo "TOOLKIT PREFLIGHT"
echo "=========================================="
echo "Toolkit root: $TOOLKIT_ROOT"
if [ -n "$TASK_PATH" ]; then
    echo "Task path: $TASK_PATH"
else
    echo "Task path: (none)"
fi

check_docker
check_tools
check_env_and_credentials
check_network
check_task_static

echo ""
echo "=========================================="
echo "PREFLIGHT SUMMARY"
echo "=========================================="
echo -e "Pass: ${GREEN}$PASS_COUNT${NC}  Warn: ${YELLOW}$WARN_COUNT${NC}  Fail: ${RED}$FAIL_COUNT${NC}"

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo ""
    echo "Preflight found blocker(s). Fix the FAIL items before running trials."
    exit 1
fi

if [ "$WARN_COUNT" -gt 0 ]; then
    echo ""
    echo "Preflight passed with warnings. Review WARN items before long trial runs."
else
    echo ""
    echo "Preflight passed."
fi
