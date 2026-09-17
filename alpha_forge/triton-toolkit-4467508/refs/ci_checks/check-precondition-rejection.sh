#!/bin/bash
# Wrapper that invokes the Python implementation of check-precondition-rejection
# so it picks up automatically in validate.sh's static-checks loop (which
# iterates check-*.sh by convention).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$SCRIPT_DIR/check-precondition-rejection.py" "$@"
