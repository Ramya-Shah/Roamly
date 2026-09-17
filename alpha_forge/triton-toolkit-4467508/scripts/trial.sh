#!/bin/bash
# Run difficulty trials: N agents x M trials, then analyze.
#
# Defaults:
#   agents: claude-code, codex, terminus-2 (filtered to credentialed agents)
#   trials per agent: 5 (matches the >=5-substantive bar enforced by submit.sh)
#   concurrency: 3 (parallel trials per harbor run; reduces install-stage OOMs)
#   claude-code model: claude-sonnet-5 (override via CLAUDE_CODE_MODEL env)
#   claude-code max output tokens: 128000 (override via CLAUDE_CODE_MAX_OUTPUT_TOKENS)
#
# Usage: scripts/trial.sh <task-path> [--trials N] [--agents list] [--concurrency N]
#        scripts/trial.sh <task-path> --resume latest|<job-dir> [--analyze-only]
# Example: scripts/trial.sh tasks/compile-postgres-with-sanitizers
#
# --concurrency forwards to harbor's -n (parallel trials within a single
# harbor invocation). Default 3 to reduce concurrent claude-code installer
# pressure that drove ~27% trial-validity loss in past batches. Override:
#   --concurrency 9 for max parallelism on a beefy host
#   --concurrency 1 if you're still seeing install OOMs
#
# After the main run, the script auto-tops-up failed trial slots until at
# least MIN_VALID trials produced a real verifier/reward.txt (or the
# MAX_TOTAL_TRIALS cap fires). By default MIN_VALID follows --trials, so
# `--trials 3` stays a cheap iteration run while the default run targets 5.
# Runs with both exception.txt and reward.txt count as valid: the verifier
# reached a reward decision, even if the agent later hit a timeout or
# orchestration exception.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLKIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/lib/toolkit-env.sh"
source "$SCRIPT_DIR/lib/trial-rejects.sh"

# Harbor must run with CWD = the host-visible workspace path so its nested
# container mounts resolve against the host Docker daemon.
HARBOR_CWD="${HOST_WORKSPACE:-$TOOLKIT_ROOT}"
ANALYSIS_RUBRIC="refs/rubrics/trial-analysis.toml"
ANALYSIS_JOB_PROMPT="refs/rubrics/trial-analysis-job.txt"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <task-path> [--trials N] [--agents list] [--concurrency N] [--resume latest|<job-dir>] [--analyze-only]" >&2
    exit 1
fi

TASK_PATH="$1"
shift

# Default is 5 trials per agent — this matches the ≥5-substantive bar enforced
# by check-trial-signal.sh and submit.sh. Workers can pass --trials N to
# override (e.g., during early iteration with --trials 3 for fast feedback).
TRIALS=5
AGENTS="claude-code codex terminus-2"
AGENTS_EXPLICIT=0
# Harbor concurrency default 3 (was unset → harbor default 4). 9-way parallel
# `claude-code` installs concentrated install-stage OOMs and rate-limit
# failures at the install CDN. Capping at 3 reduces concurrent installs at
# any moment without giving up much wall-clock time, and the top-up loop
# below will fill any gaps. Workers can override with --concurrency N
# (use a higher value on a beefy host; lower if you still see install OOMs).
CONCURRENCY="3"
RESUME_JOB_DIR=""
ANALYZE_ONLY=0

# Auto-retry: after the main harbor run, if fewer than $MIN_VALID trials
# produced a real verifier/reward.txt (i.e. install OOMs and scheduler stalls
# don't count), top up with additional trial slots from the calibration agent
# (claude-code) until either MIN_VALID is reached or the hard cap fires.
# The cap exists to bound cost on tasks with truly broken environments.
MIN_VALID="${MIN_VALID:-}"
MAX_TOTAL_TRIALS=20
MAX_CONSECUTIVE_DRY_TOPUPS=2  # abort if N consecutive top-up batches yielded no new valid trial

# Model defaults per agent. Drop the "anthropic/"/"openai/"/"gemini/"
# provider prefix — the DataAnnotation proxy's model-mapping layer rejects
# those fully-qualified names ("Invalid model: anthropic/claude-opus-4-8")
# but accepts the bare model name ("claude-opus-4-8" -> routed correctly).
#
# claude-code defaults to Sonnet 5 for difficulty calibration. cheat-trial.sh
# overrides this to Opus 4.8 via CLAUDE_CODE_MODEL since cheat trials want the
# strongest possible adversary, not the calibration agent.
model_for_agent() {
    case "$1" in
        claude-code) echo "${CLAUDE_CODE_MODEL:-claude-sonnet-5}" ;;
        codex)       echo "gpt-5.4" ;;
        terminus-2)  echo "gemini-3.1-pro-preview" ;;
        *)           echo "" ;;
    esac
}

while [ $# -gt 0 ]; do
    case "$1" in
        --trials)
            TRIALS="$2"
            shift 2
            ;;
        --agents)
            AGENTS="$2"
            AGENTS_EXPLICIT=1
            shift 2
            ;;
        --concurrency)
            CONCURRENCY="$2"
            shift 2
            ;;
        --resume)
            RESUME_JOB_DIR="$2"
            shift 2
            ;;
        --analyze-only)
            ANALYZE_ONLY=1
            shift
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

if [ -z "$MIN_VALID" ]; then
    MIN_VALID="$TRIALS"
fi

if [ ! -d "$TASK_PATH" ]; then
    echo "ERROR: task directory not found: $TASK_PATH" >&2
    exit 1
fi

if [ "$ANALYZE_ONLY" -eq 0 ]; then
    require_toolkit_command harbor "trial.sh uses Harbor to launch agent trials."
fi
require_toolkit_command claude "trial.sh uses Claude Code to analyze trajectories."

TASK_ABS="$(cd "$TASK_PATH" && pwd)"
TASK_NAME=$(basename "$TASK_ABS")
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DIR_PREFIX="${JOB_DIR_PREFIX:-trial}"
JOB_TIMESTAMP_GLOB='[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]'

if ! bash "$TOOLKIT_ROOT/refs/ci_checks/check-task-identity.sh" "$TASK_PATH"; then
    echo "ERROR: task identity preflight failed; fix the task slug/task.toml before trialing." >&2
    exit 1
fi

if [ "$ANALYZE_ONLY" -eq 0 ] && ! bash "$TOOLKIT_ROOT/refs/ci_checks/check-internet-policy.sh" "$TASK_PATH"; then
    echo "ERROR: internet policy preflight failed; keep the agent environment online before trialing." >&2
    exit 1
fi

if [ "$ANALYZE_ONLY" -eq 1 ] && [ -z "$RESUME_JOB_DIR" ]; then
    RESUME_JOB_DIR="latest"
fi

if [ -f "$TOOLKIT_ROOT/.env" ]; then
    set -a
    source "$TOOLKIT_ROOT/.env"
    set +a
fi

# 32K/64K output ceilings are outdated/manual-config artifacts for our trials.
# Default Claude Code to 128K for both regular trials and cheat trials (which
# delegate through this script), while preserving explicit worker/admin overrides.
export CLAUDE_CODE_MAX_OUTPUT_TOKENS="${CLAUDE_CODE_MAX_OUTPUT_TOKENS:-128000}"

# Switch to the host-visible path so Harbor's nested container mounts resolve.
cd "$HARBOR_CWD"

find_latest_job_dir() {
    local latest="" d clean
    for d in "harbor-jobs/${DIR_PREFIX}-${TASK_NAME}-"$JOB_TIMESTAMP_GLOB/; do
        clean="${d%/}"
        if [ -d "$clean" ]; then
            latest="$clean"
        fi
    done
    echo "$latest"
}

# Without explicit --agents, filter the default list to agents whose
# credentials are available. Explicit --agents is trusted as-is. Analyze-only
# mode does not need agent credentials.
if [ "$ANALYZE_ONLY" -eq 0 ]; then
    if [ "$AGENTS_EXPLICIT" -eq 0 ]; then
        FILTERED=""
        for agent in $AGENTS; do
            case "$agent" in
                claude-code) [ -n "${ANTHROPIC_API_KEY:-}" ] && FILTERED="$FILTERED $agent" ;;
                codex)       [ -n "${OPENAI_API_KEY:-}" ]    && FILTERED="$FILTERED $agent" ;;
                terminus-2)  [ -n "${GEMINI_API_KEY:-}" ]    && FILTERED="$FILTERED $agent" ;;
            esac
        done
        AGENTS="${FILTERED# }"
    fi

    if [ -z "$AGENTS" ]; then
        echo "ERROR: no agents have credentials available." >&2
        echo "       Set at least ANTHROPIC_API_KEY in .env (for claude-code)." >&2
        exit 1
    fi
fi

RESUMING=0
if [ -n "$RESUME_JOB_DIR" ]; then
    RESUMING=1
    if [ "$RESUME_JOB_DIR" = "latest" ]; then
        JOB_DIR="$(find_latest_job_dir)"
        if [ -z "$JOB_DIR" ]; then
            echo "ERROR: no harbor-jobs/${DIR_PREFIX}-${TASK_NAME}-*/ directory found to resume." >&2
            exit 1
        fi
    else
        JOB_DIR="$RESUME_JOB_DIR"
    fi
    if [ ! -d "$JOB_DIR" ]; then
        echo "ERROR: resume job directory not found: $JOB_DIR" >&2
        exit 1
    fi
else
    # JOB_DIR_PREFIX defaults to "trial". cheat-trial.sh sets it to "cheat-trial"
    # when delegating, so cheat output lands in a separate harbor-jobs entry and
    # submit.sh can bundle both regular and cheat artifacts side by side without
    # the later run silently overwriting the earlier one.
    JOB_DIR="harbor-jobs/${DIR_PREFIX}-$TASK_NAME-$TIMESTAMP"
fi

mkdir -p "$JOB_DIR"

echo "=========================================="
echo "DIFFICULTY TRIAL: $TASK_NAME"
if [ "$ANALYZE_ONLY" -eq 1 ]; then
    echo "Mode: analyze existing job only"
elif [ "$RESUMING" -eq 1 ]; then
    echo "Mode: resume existing job"
else
    echo "Trials per agent: $TRIALS (parallel via harbor -k)"
fi
if [ "$ANALYZE_ONLY" -eq 0 ]; then
    echo "Agents: $AGENTS"
fi
echo "Job dir: $JOB_DIR"
echo "=========================================="

if [ "$ANALYZE_ONLY" -eq 0 ] && [ "$RESUMING" -eq 0 ]; then
    for agent in $AGENTS; do
        model="$(model_for_agent "$agent")"
        if [ -z "$model" ]; then
            echo "WARNING: no default model for agent $agent; skipping" >&2
            continue
        fi
        echo ""
        echo ">>> $agent × $TRIALS parallel trials (model: $model)"
        harbor run \
            -p "$TASK_PATH" \
            -a "$agent" \
            -m "$model" \
            -o "$JOB_DIR" \
            -k "$TRIALS" \
            ${CONCURRENCY:+-n "$CONCURRENCY"} \
            --yes \
            --no-delete || echo "   (one or more trials did not achieve reward 1.0 — expected for hard tasks)"
    done
elif [ "$ANALYZE_ONLY" -eq 0 ]; then
    echo ""
    echo ">>> Resuming $JOB_DIR; skipping initial launch and topping up from existing trials."
fi

# --- Top-up loop: ensure >= $MIN_VALID *valid* trials in $JOB_DIR ---------
# Valid = trial subdir has verifier/reward.txt and no excluding
# .user-reject.md artifact. Install-stage OOMs, scheduler stalls, and
# worker-rejected infra/tooling artifacts do not count.
#
# Top-up uses the calibration agent (claude-code if credentialed, otherwise
# the first available agent). Each retry calls harbor with -k <missing> so
# it produces a parallel sub-trial layer under the same JOB_DIR — the
# trial-analysis pass picks them up automatically via the */${TASK_NAME}__*
# glob.
count_valid_trials() {
    local dir="$1" count=0 child
    for child in "$dir"/*/"${TASK_NAME}__"*/; do
        local clean="${child%/}"
        [ -d "$clean" ] || continue
        trial_reject_excludes_substantive "$clean" && continue
        [ -f "$clean/verifier/reward.txt" ] || continue
        count=$((count + 1))
    done
    echo "$count"
}

VALID=$(count_valid_trials "$JOB_DIR")
if [ "$ANALYZE_ONLY" -eq 0 ]; then
    # Top-up agent selection: prefer claude-code, else first available agent.
    TOPUP_AGENT=""
    for a in $AGENTS; do
        if [ "$a" = "claude-code" ]; then TOPUP_AGENT="$a"; break; fi
    done
    if [ -z "$TOPUP_AGENT" ]; then
        TOPUP_AGENT="${AGENTS%% *}"
    fi
    TOPUP_MODEL="$(model_for_agent "$TOPUP_AGENT")"

    if [ "$RESUMING" -eq 1 ]; then
        TRIALS_RUN_TOTAL=$(find "$JOB_DIR" -maxdepth 2 -type d -name "${TASK_NAME}__*" 2>/dev/null | wc -l | tr -d ' ')
    else
        TRIALS_RUN_TOTAL=0
        for a in $AGENTS; do
            TRIALS_RUN_TOTAL=$((TRIALS_RUN_TOTAL + TRIALS))
        done
    fi

    CONSECUTIVE_DRY=0
    PREV_VALID=$VALID

    echo ""
    echo ">>> Valid trials so far: $VALID / $MIN_VALID"

    while [ "$VALID" -lt "$MIN_VALID" ] && [ "$TRIALS_RUN_TOTAL" -lt "$MAX_TOTAL_TRIALS" ]; do
        if [ -z "$TOPUP_MODEL" ]; then
            echo "ERROR: no top-up model available for agent $TOPUP_AGENT" >&2
            break
        fi
        MISSING=$((MIN_VALID - VALID))
        ROOM=$((MAX_TOTAL_TRIALS - TRIALS_RUN_TOTAL))
        TOPUP_N=$MISSING
        [ "$TOPUP_N" -gt "$ROOM" ] && TOPUP_N=$ROOM
        echo ""
        echo ">>> Top-up: need $MISSING more valid trial(s); requesting $TOPUP_N (running total: $TRIALS_RUN_TOTAL/$MAX_TOTAL_TRIALS attempts)"
        harbor run \
            -p "$TASK_PATH" \
            -a "$TOPUP_AGENT" \
            -m "$TOPUP_MODEL" \
            -o "$JOB_DIR" \
            -k "$TOPUP_N" \
            ${CONCURRENCY:+-n "$CONCURRENCY"} \
            --yes \
            --no-delete || echo "   (top-up: one or more trials did not achieve reward 1.0 — expected)"
        TRIALS_RUN_TOTAL=$((TRIALS_RUN_TOTAL + TOPUP_N))
        VALID=$(count_valid_trials "$JOB_DIR")
        echo ">>> Valid trials so far: $VALID / $MIN_VALID"
        if [ "$VALID" -le "$PREV_VALID" ]; then
            CONSECUTIVE_DRY=$((CONSECUTIVE_DRY + 1))
        else
            CONSECUTIVE_DRY=0
        fi
        PREV_VALID=$VALID
        if [ "$CONSECUTIVE_DRY" -ge "$MAX_CONSECUTIVE_DRY_TOPUPS" ]; then
            echo "" >&2
            echo "ERROR: $CONSECUTIVE_DRY consecutive top-up batches produced no new valid trials." >&2
            echo "  This usually means a setup-side problem (claude-code installer OOM, network," >&2
            echo "  Docker image build failure). Investigate harbor-jobs/ before retrying." >&2
            break
        fi
    done

    if [ "$VALID" -lt "$MIN_VALID" ]; then
        echo "" >&2
        echo "WARNING: ended with $VALID/$MIN_VALID valid trials." >&2
        echo "  scripts/submit.sh will block until latest regular and cheat jobs clear 5 substantive trials." >&2
    fi
else
    echo ""
    echo ">>> Analyze-only: found $VALID / $MIN_VALID valid trials in $JOB_DIR"
fi

# Aggregate all trial subdirs across all timestamp subdirs (initial run +
# any top-up runs) so the analysis sees every trial.
TRIAL_COUNT=$(find "$JOB_DIR" -maxdepth 2 -type d -name "${TASK_NAME}__*" 2>/dev/null | wc -l | tr -d ' ')

if [ "$TRIAL_COUNT" -eq 0 ]; then
    echo "WARNING: no trial data found under $JOB_DIR — skipping analyze"
    echo "Trial results in: $JOB_DIR"
    exit 0
fi

echo ""
echo "=========================================="
echo "ANALYZING TRAJECTORIES ($TRIAL_COUNT trials)"
echo "=========================================="

# Analysis: rubric as system prompt, Read/Glob/Grep to examine trajectories
# and task files, output streamed to stdout and a markdown file.
ANALYSIS_RUBRIC_PATH="$TOOLKIT_ROOT/refs/rubrics/trial-analysis.toml"
ANALYSIS_FILE="$JOB_DIR/trial-analysis.md"

ANALYSIS_RUBRIC_CONTENT="$(cat "$ANALYSIS_RUBRIC_PATH")"

ANALYSIS_USER_PROMPT="You are analyzing agent trial trajectories against the 4-criterion analysis rubric in your system prompt. Your CWD is the Harbor job directory. Trial subdirectories are nested one level under timestamped parent dirs — find them all with glob \`*/${TASK_NAME}__*/\`. The original task source lives at: $TASK_ABS (available via --add-dir).

For EACH trial subdirectory found, read:
1. \`<trial>/agent/trajectory.json\` — the agent's action log
2. \`<trial>/verifier/reward.txt\` — the trial's final reward
3. \`<trial>/trial.log\` — trial orchestration log
4. \`<trial>/exception.txt\` if it exists — any infrastructure/agent errors
5. \`<trial>/.user-reject.md\` if it exists — worker-authored audit note for a non-substantive infra/tooling artifact
6. Files under $TASK_ABS/ — task definition for context (instruction.md, task.toml, tests/)

Classify agent/tooling artifacts separately from task defects. If a trial is dominated by ExitPlanMode/planning-mode confusion, an unavailable agent tool, a model API/tool-wrapper failure, a worker-authored .user-reject.md artifact, or a Harbor orchestration exception before the agent meaningfully engaged the task, mark the task-facing criteria as N/A where appropriate and say it is an agent/tooling artifact in the evidence. Do not convert those artifacts into task_specification, difficulty_crux, or low_timeout failures. User-rejected trials should remain visible in the analysis but should not drive difficulty/pass-rate conclusions.

For each trial subdirectory, output a markdown section in this exact format:

## <trial-id> — reward: <X.X or missing>

- **[PASS|FAIL|N/A] task_specification:** 2-5 sentences of evidence.
- **[PASS|FAIL|N/A] reward_hacking:** 2-5 sentences of evidence.
- **[PASS|FAIL|N/A] difficulty_crux:** 2-5 sentences of evidence.
- **[PASS|FAIL|N/A] low_timeout:** 2-5 sentences of evidence.

Do not suggest fixes. After the per-trial sections, emit a single \"Convergence summary\" section that makes bivalence patterns obvious. Use this exact format:

## Convergence summary

- **Trial outcomes:** P passed / F failed / I infra-failed (out of N total)
- **Agent/tooling artifacts:** A trials (examples: ExitPlanMode/planning-mode loops, unavailable tools, API/tool-wrapper failures, or pre-task Harbor orchestration exceptions)
- **Criterion-level failure clustering:**
    - task_specification: X/F failed trials fail this criterion
    - difficulty_crux: Y/F failed trials fail this criterion
    - low_timeout: Z/F failed trials fail this criterion
    - reward_hacking: W/F failed trials fail this criterion

- **Convergence verdict:** one of:
    - **LIKELY BIVALENCE** — if >=66% of failed trials fail on \`task_specification\` AND the failing trajectories quote substantially the same instruction phrase with substantially the same alternate reading. List the disputed phrase (verbatim from instruction.md, with line numbers), the agents' shared alternate reading, and what the verifier actually checks.
    - **LIKELY INTENDED CRUX** — if >=66% of failed trials fail on \`difficulty_crux\` AND the spec has a disambiguating phrase the agents missed. Quote the disambiguating phrase from instruction.md.
    - **LIKELY UNDERSPECIFIED RESOURCES** — if >=33% of failed trials fail on \`low_timeout\` (agents were still making progress at cutoff).
    - **LIKELY AGENT/TOOLING ARTIFACT** — if >=33% of failed or infra-failed trials are dominated by agent/tooling artifacts rather than task work.
    - **MIXED / NO STRONG PATTERN** — if failures don't cluster on one criterion, or trial count is too small (N<3).
    - **TOO EASY** — if pass rate >=80%, regardless of failure clustering.

- **Worker action:** one or two sentences advising what to do based on the verdict. For bivalence, say which line of instruction.md to rewrite and how. For intended crux, confirm calibration and proceed. For underspecified resources, say which task.toml value to raise. For agent/tooling artifacts, say to rerun/merge/top-up trials and avoid changing task files unless independent evidence points to a task issue. For too-easy, suggest hardening moves.

Then end with a single summary line:

**JOB SUMMARY:** N trials, M achieved reward ≥1.0, K exceptions."

{
    echo "# Trial Analysis — $TASK_NAME"
    echo ""
    echo "**Generated:** $(date '+%Y-%m-%d %H:%M:%S %Z')"
    echo "**Job dir:** \`$JOB_DIR\`"
    echo "**Task source:** \`$TASK_ABS\`"
    echo "**Rubric:** trial-analysis.toml (4 criteria)"
    echo "**Trial count:** $TRIAL_COUNT"
    echo ""
    echo "---"
    echo ""
} > "$ANALYSIS_FILE"

(cd "$JOB_DIR" && claude --print \
    --model claude-opus-4-8 \
    --effort max \
    --allowed-tools "Read,Glob,Grep" \
    --add-dir "$TASK_ABS" \
    --append-system-prompt "$ANALYSIS_RUBRIC_CONTENT" \
    "$ANALYSIS_USER_PROMPT") | tee -a "$ANALYSIS_FILE"

# --- Job-level summary (aggregates across per-trial analyses) ---
echo ""
echo "=========================================="
echo "JOB SUMMARY"
echo "=========================================="

JOB_PROMPT_PATH="$TOOLKIT_ROOT/$ANALYSIS_JOB_PROMPT"
SUMMARY_FILE="$JOB_DIR/job-summary.md"
JOB_PROMPT_TEMPLATE="$(cat "$JOB_PROMPT_PATH")"
TRIAL_RESULTS="$(cat "$ANALYSIS_FILE")"
JOB_USER_PROMPT="${JOB_PROMPT_TEMPLATE//\{trial_results\}/$TRIAL_RESULTS}"

{
    echo "# Job Summary — $TASK_NAME"
    echo ""
    echo "**Generated:** $(date '+%Y-%m-%d %H:%M:%S %Z')"
    echo "**Job dir:** \`$JOB_DIR\`"
    echo ""
    echo "---"
    echo ""
} > "$SUMMARY_FILE"

claude --print --model claude-opus-4-8 --effort max "$JOB_USER_PROMPT" | tee -a "$SUMMARY_FILE"

echo ""
echo "=========================================="
echo "Trial results in: $JOB_DIR"
echo "Analysis saved to: $ANALYSIS_FILE"
echo "Job summary:      $SUMMARY_FILE"
echo "=========================================="

if [ "${CHEAT_TRIAL_DELEGATED:-}" != "1" ]; then
    echo ""
    echo "Next: scripts/cheat-trial.sh $TASK_PATH  (or scripts/submit.sh when trials look right)"
fi
