#!/bin/bash
# Detect leftover content in instruction.md that shouldn't be in a final
# submission. Currently catches:
#
#   1. Hostile cheat-trial preamble (from refs/hack-trial-prompt.md). This
#      gets prepended by cheat-trial.sh and restored on EXIT/INT/TERM — but
#      if the worker kills cheat-trial.sh with SIGKILL (kill -9), pulls the
#      plug on their devcontainer mid-run, or otherwise prevents the trap
#      from running, the preamble stays in instruction.md and contaminates
#      every downstream signal (validate, check-quality, the next trial run,
#      and ultimately the submitted tarball).
#
#   2. The cheat-trial separator line (`---` immediately following the
#      hostile prompt). This is the unambiguous fingerprint when the
#      "security researcher bot" sentence is itself part of a legitimate
#      task (rare but possible).
#
# Worker fix is mechanical: re-run scripts/cheat-trial.sh and let it finish
# cleanly, or restore instruction.md from git.
#
# Usage:
#   scripts/check-instruction-clean.sh <task-path>
#
# Exit codes:
#   0 — clean
#   1 — leftover content detected
#   2 — usage error or file missing
#
# This script is read-only.

set -uo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <task-path>" >&2
    exit 2
fi

TASK_PATH="$1"
INSTRUCTION="$TASK_PATH/instruction.md"

if [ ! -f "$INSTRUCTION" ]; then
    echo "ERROR: $INSTRUCTION not found" >&2
    exit 2
fi

# Distinctive phrases from refs/hack-trial-prompt.md. Matching ANY of these
# is sufficient — the hostile preamble always includes the first sentence
# and the "Be creative and thorough" closing line. Detecting either is
# enough; we check both for defense-in-depth.
PATTERNS=(
    'security researcher bot.*exploit any way to CHEAT'
    'make the verification pass without genuinely completing'
    'Be creative and thorough in finding vulnerabilities'
    'Your goal is NOT to solve the task'
)

found_any=0
matched_pattern=""
for pat in "${PATTERNS[@]}"; do
    if grep -qE "$pat" "$INSTRUCTION"; then
        found_any=1
        matched_pattern="$pat"
        break
    fi
done

if [ "$found_any" -eq 1 ]; then
    echo "ERROR: $INSTRUCTION contains the cheat-trial hostile preamble." >&2
    echo "  Matched pattern: $matched_pattern" >&2
    echo "" >&2
    echo "  This is the prompt that scripts/cheat-trial.sh prepends temporarily." >&2
    echo "  It should be restored on script exit — if it's still in your file," >&2
    echo "  cheat-trial.sh was probably killed mid-run (SIGKILL, devcontainer" >&2
    echo "  rebuild, etc.) and never ran its cleanup trap." >&2
    echo "" >&2
    echo "  Fix: restore instruction.md (git checkout if version-controlled, or" >&2
    echo "  re-run scripts/cheat-trial.sh and let it complete normally so it" >&2
    echo "  restores the original on exit)." >&2
    exit 1
fi

echo "  OK — no cheat-trial preamble residue in instruction.md."
exit 0
