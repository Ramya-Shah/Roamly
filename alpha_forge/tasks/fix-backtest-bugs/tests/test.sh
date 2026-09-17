#!/usr/bin/env bash
# Verifier for fix-backtest-bugs.
#
# Uses the system Python rather than uvx because the container image
# (environment/Dockerfile) already installs numpy, numba, hftbacktest, and
# pytest. uvx would create a fresh isolated venv that does NOT inherit those
# site-packages, requiring hftbacktest and numba to be compiled from scratch
# on every verifier run - slow and brittle. The system Python is the right
# choice when all test dependencies are pinned in the Dockerfile.
set -euo pipefail

cd /app
mkdir -p /logs/verifier /verifier

if python3 -m pytest --ctrf /logs/verifier/ctrf.json /tests/test_outputs.py -rA; then
    echo 1 > /logs/verifier/reward.txt
    echo 1 > /verifier/reward.txt
else
    echo 0 > /logs/verifier/reward.txt
    echo 0 > /verifier/reward.txt
fi

