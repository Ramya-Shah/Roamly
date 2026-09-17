#!/usr/bin/env bash
# Verifier for debug-hft-backtest-engine.
#
# Uses the system Python rather than uvx because the container image
# (environment/Dockerfile) already installs numpy, numba, hftbacktest, and
# pytest. uvx would create a fresh isolated venv that does NOT inherit those
# site-packages, requiring hftbacktest and numba to be compiled from scratch
# on every verifier run — slow and brittle.  The system Python is the right
# choice when all test dependencies are pinned in the Dockerfile.
set -euo pipefail

cd /app
python3 -m pytest \
    --ctrf /logs/verifier/ctrf.json \
    /tests/test_outputs.py \
    -rA

if [ $? -eq 0 ]; then
    echo 1 > /logs/verifier/reward.txt
else
    echo 0 > /logs/verifier/reward.txt
fi
