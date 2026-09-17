# Changelog

## 4467508

- Clarified task category guidance across the rubric, docs, and scaffold: `other` is valid, but only as a last resort when no named category reasonably fits.
- Clarified the `instruction.md` scaffold comment so workers delete the entire comment block and replace the example task text.
- Default regular and cheat trial gates now require 5 substantive runs each. `trial.sh` defaults to 5 trials at 3-way Harbor concurrency, and `--trials N` remains available for cheap early iteration.
- The default regular-trial calibration model has been updated; `CLAUDE_CODE_MODEL` still overrides it for admin/debug runs. `preflight.sh` now catches stale Claude Code versions before trialing.
- `check-trial-signal.sh`, `trial.sh`, and `submit.sh` all use the same substantive-trial definition: `verifier/reward.txt` exists, and the slot has not been explicitly user-rejected as an infra/tooling artifact. Runs with both `exception.txt` and `reward.txt` still count.
- Regular trial pass rate now blocks at 80% or higher, so 4/5 passing trials is treated as too easy unless `submit.sh --allow-trivial` is used.
- `check-proposal.sh`, `check-quality.sh`, trial analysis, job summaries, cheat trials, and the devcontainer Claude alias now use Claude Opus 4.8 with max reasoning effort where Opus is used.
- Added `scripts/trial-user-reject.sh` for auditable single-slot infra/tooling rejects. It writes `.user-reject.md` next to the trial, leaves the original logs/trajectory intact, and excludes that slot from substantive counts.
- Claude Code trials now default `CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000`. A 32K or 64K ceiling indicates an older/manual configuration and should be topped up at 128K; 128K planning/output-ceiling failures count as failed-agent signal when `reward.txt` exists.
- Added `scripts/preflight.sh [task-path]` to catch common setup blockers before long trial runs: Docker daemon/resources/disk, Harbor/Claude Code availability, Anthropic key/proxy configuration, old proxy domains, 128K output-token settings, targeted network reachability, and task identity/internet/Dockerfile-reference checks when a task path is supplied.
- Added `docs/trial-triage.md`, a short decision guide for setup failures, missing rewards, top-ups, user-rejected infra artifacts, concurrency 1, trial-signal gates, and final readiness.
- `submit.sh` now includes `latest-trial-user-rejects.md` and/or `latest-cheat-trial-user-rejects.md` in the tarball when user-reject artifacts exist, so downstream review can see the worker's reasoning.
- `trial-analysis.md` now tells the reviewer to read `.user-reject.md` artifacts and keep user-rejected slots visible as agent/tooling artifacts rather than task defects.
- Top-level `[environment] allow_internet = false` is now rejected before validation/trial because agent setup needs network. To mirror TB3, keep the agent environment online and use a separate vendored `[verifier.environment] allow_internet = false` only for advanced offline verifier tasks.
- Rubric/docs now recognize root-level Harbor `artifacts = [...]` for separate verifier tasks; declared artifacts are read in the verifier at the same absolute source paths. `check-test-file-references.sh` now ignores project tests nested under `environment/**/tests/test_*.py` instead of mistaking them for hidden verifier tests.
- The packed toolkit still pins this changelog section to the zip commit via `tools/pack.sh`, so the top heading matches the packaged SHA.

## 4e80416

- Lift worker baseline: trial-signal gate, artifact gate, spec-defect detectors, sharper proposal review.

## 3877a1c

- Add fixture-leak detection to validate.sh's static checks plus a matching rubric clarification.

## 3935d3b

- Add pre-submit cross-check prompt in `CLAUDE.md` so workers reliably ask in-container Claude to review spec/test alignment before submit.

## ce8b7d4

- `submit.sh` verifies the produced tarball by re-extracting it into a scratch dir and re-running `validate.sh` against the extraction. Catches packaging defects (files needed by the Dockerfile that get excluded by `.gitignore`/`.dockerignore` and silently dropped from the tarball).
- `cheat-trial.sh` now writes harbor output to `harbor-jobs/cheat-trial-<task>-*/` instead of sharing the regular trial folder. Eliminates the mtime-mislabel where the most recent run would overwrite `latest-trial-analysis.md` regardless of kind.

## 649e60d

- Add rubric guidance to flag spec/test mismatches.
