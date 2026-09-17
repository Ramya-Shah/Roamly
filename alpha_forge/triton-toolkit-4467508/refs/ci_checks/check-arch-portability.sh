#!/bin/bash
# Detect hardcoded x86_64 architecture pinning in oracle/environment files
# that would cause validate.sh to fail on aarch64 admin hosts (Apple Silicon).
#
# This is an advisory check — some tasks legitimately need x86_64 (binary
# analysis, specific compiler builds). Workers should EITHER (a) generalize
# the task to be arch-portable, OR (b) declare the host-arch requirement in
# task.toml so admin review knows to skip on non-matching hosts.
#
# Exits 0 with a warning; never blocks. Worker decides whether to act.
#
# Usage:
#   refs/ci_checks/check-arch-portability.sh <task-path>

set -uo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <task-path>" >&2
    exit 1
fi

TASK_DIR="$1"
if [ ! -d "$TASK_DIR" ]; then
    echo "ERROR: task directory not found: $TASK_DIR" >&2
    exit 1
fi

# Patterns that flag arch-specific pinning. Each pattern matches a
# distinctive substring we'd expect in code that won't run on other archs.
# Scoped to solution/, environment/, and task.toml — instruction.md naming
# x86_64 is allowed (the agent may be asked to handle multi-arch).
PATTERNS=(
    'arch="x86_64"'              # Alpine APKBUILD
    'arch=x86_64'                 # Same, unquoted
    '--platform=linux/amd64'      # Docker build pin
    '--platform linux/amd64'      # Same, space form
    '--platform=linux/arm64'      # Worth flagging the reverse too
    '--platform linux/arm64'
    'x86_64-linux-gnu/'           # ld.so cache paths
    'x86_64-pc-linux'             # Build target triples
)

scan_paths=()
for sub in solution environment; do
    if [ -d "$TASK_DIR/$sub" ]; then
        scan_paths+=("$TASK_DIR/$sub")
    fi
done
if [ -f "$TASK_DIR/task.toml" ]; then
    scan_paths+=("$TASK_DIR/task.toml")
fi

if [ "${#scan_paths[@]}" -eq 0 ]; then
    # Nothing to scan; treat as clean.
    exit 0
fi

found=0
for pat in "${PATTERNS[@]}"; do
    # grep -r across the collected paths. -F for fixed-string match keeps the
    # patterns literal (no regex surprises). -l prints only filenames.
    hits=$(grep -rlF "$pat" "${scan_paths[@]}" 2>/dev/null || true)
    if [ -n "$hits" ]; then
        if [ "$found" -eq 0 ]; then
            echo "WARNING: architecture pinning detected in oracle/environment."
            echo "  This task may fail to validate on hosts of a different architecture."
            found=1
        fi
        echo "  pattern: $pat"
        echo "$hits" | sed 's/^/    in: /'
    fi
done

if [ "$found" -eq 1 ]; then
    echo ""
    echo "  If the pinning is intentional (e.g. x86_64-only binary), document the"
    echo "  requirement in task.toml (e.g., add a comment under [agent] noting"
    echo "  'requires linux/amd64 host'). Otherwise, generalize:"
    echo "    - Alpine APKBUILD: replace arch=\"x86_64\" with arch=\"all\" if portable"
    echo "    - Dockerfile: drop --platform pins or use 'BUILDPLATFORM' multi-arch builds"
    echo "    - Build triples: use 'uname -m' or autoconf-style detection"
    echo ""
fi

# Advisory only — never block.
exit 0
