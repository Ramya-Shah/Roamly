#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLKIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CHECK="$TOOLKIT_ROOT/refs/ci_checks/check-test-file-references.sh"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

TASK_DIR="$TMP_DIR/tasks/nested-env-tests"
mkdir -p \
    "$TASK_DIR/environment/project/tests" \
    "$TASK_DIR/tests/unit" \
    "$TASK_DIR/tests" \
    "$TASK_DIR/solution"

cat > "$TASK_DIR/task.toml" <<'EOF'
schema_version = "1.3"

[task]
name = "nested-env-tests"
description = "demo"

[metadata]
category = "software_engineering"
expert_time_estimate_hours = 1

[verifier]
timeout_sec = 120.0

[agent]
timeout_sec = 120.0

[environment]
allow_internet = true
EOF

cat > "$TASK_DIR/instruction.md" <<'EOF'
Write `/app/result.txt` and `/app/extra.txt`.
EOF

cat > "$TASK_DIR/solution/solve.sh" <<'EOF'
#!/bin/bash
echo ok > result.txt
echo extra > extra.txt
EOF

cat > "$TASK_DIR/tests/test_outputs.py" <<'EOF'
from pathlib import Path


def test_result():
    assert Path("/app/result.txt").read_text().strip() == "ok"
EOF

cat > "$TASK_DIR/tests/unit/test_extra.py" <<'EOF'
from pathlib import Path


def test_extra():
    assert Path("/app/extra.txt").read_text().strip() == "extra"
EOF

cat > "$TASK_DIR/environment/project/tests/test_sample.py" <<'EOF'
from pathlib import Path


def test_project_contract():
    assert Path("/app/internal.txt").exists()
EOF

(
    cd "$TMP_DIR"
    "$CHECK" tasks/nested-env-tests
)

cat > "$TASK_DIR/instruction.md" <<'EOF'
Write `/app/result.txt`.
EOF

set +e
(
    cd "$TMP_DIR"
    "$CHECK" tasks/nested-env-tests
)
RC=$?
set -e

if [ "$RC" -eq 0 ]; then
    echo "Expected undocumented nested top-level verifier output to fail" >&2
    exit 1
fi

echo "OK - check-test-file-references regression tests passed."
