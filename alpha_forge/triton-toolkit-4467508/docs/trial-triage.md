# Trial Triage

Use this when a trial, cheat trial, or submit gate fails and you need the next command. It explains the decision logic around setup failures, top-ups, user-rejected infra artifacts, missing rewards, trial signal, and final readiness.

This guide does not replace `scripts/validate.sh` or the trial analysis. It helps you decide what to rerun and what not to change.

## Start Here

Before long trials:

```bash
scripts/preflight.sh tasks/<task-slug>
scripts/validate.sh tasks/<task-slug>
```

Fix `FAIL` items from preflight first. Then make validation green: oracle must get reward `1.0`, nop must get reward `0.0`, and static checks must pass.

After a regular trial, run the regular check. After a cheat trial, run the cheat check. Before submit, run both:

```bash
scripts/check-trial-signal.sh tasks/<task-slug> --kind regular
scripts/check-trial-signal.sh tasks/<task-slug> --kind cheat
```

Submit will run those gates again, but checking them early makes failures easier to understand.

## Trial Slot Types

Each trial slot lands under `harbor-jobs/.../<task-slug>__<id>/`.

| Slot type | What it means | Counts as substantive? |
|---|---|---|
| `verifier/reward.txt` exists | The verifier reached a reward decision. | Yes |
| `verifier/reward.txt` and `exception.txt` both exist | The verifier reached reward, even though Harbor also recorded an exception. | Yes |
| No `verifier/reward.txt` | Setup, agent, verifier, Docker, network, or harness work stopped before reward. | No |
| `.user-reject.md` exists | Worker marked this slot as an auditable infra/tooling reject. | No |
| Reward is `1` / `1.0` | Agent passed that slot. | Yes, passing |
| Reward is `0` / `0.0` | Agent failed that slot. | Yes, failing |

Missing reward is not task difficulty signal. It usually means the verifier never got to score the attempt.

## Missing Rewards

If `check-trial-signal.sh` reports missing rewards, inspect the job logs before changing task files. Common causes:

- Docker/image build failure.
- Agent setup failure, including Claude Code install problems.
- Network or DNS failure.
- Verifier bootstrap failure before writing `reward.txt`.
- OOM, wrapper error, or Harbor orchestration problem.

Fix the setup problem if the logs show one, then top up rather than deleting the job:

```bash
scripts/trial.sh tasks/<task-slug> --resume latest
scripts/cheat-trial.sh tasks/<task-slug> --resume latest
```

The resume command skips the initial launch for existing valid slots and adds attempts until the job has enough substantive runs, subject to the toolkit cap.

## Top-Ups

A top-up is an extra Harbor attempt added to the same latest trial job because some earlier slots did not count as substantive.

Use top-ups when:

- Some slots are missing `verifier/reward.txt`.
- You marked an infra/tooling slot with `trial-user-reject.sh`.
- The trial ended with fewer than 5 substantive regular or cheat runs.

Do not start from scratch just to replace missing-reward slots. Use `--resume latest` unless the task itself changed in a way that makes old trajectories stale.

If you changed `instruction.md`, `environment/Dockerfile`, seed data, task-visible files, resource settings, `tests/test.sh`, `tests/test_outputs.py`, or anything that changes verifier/reward behavior, run a fresh trial instead. Old trajectories or reward files are no longer clean calibration evidence.

## Merging Partial Trial Jobs

Use `merge-trial-runs.sh` when useful signal is split across multiple partial Harbor jobs for the same unchanged task version. Common causes are interrupted runs, API/setup failures, or stopped runs where some slots produced valid `verifier/reward.txt`.

Do not merge jobs if you changed `instruction.md`, tests, verifier behavior, Dockerfile/dependencies, seed data, task-visible files, or resource settings between them. Those old trajectories are stale evidence.

Merge regular and cheat jobs separately:

```bash
scripts/merge-trial-runs.sh tasks/<task-slug> --kind regular
scripts/trial.sh tasks/<task-slug> --resume latest --analyze-only

# For cheat trials:
scripts/merge-trial-runs.sh tasks/<task-slug> --kind cheat
scripts/cheat-trial.sh tasks/<task-slug> --resume latest --analyze-only
```

After merging, read the refreshed analysis and run the usual signal checks before submit:

```bash
scripts/check-trial-signal.sh tasks/<task-slug> --kind regular
scripts/check-trial-signal.sh tasks/<task-slug> --kind cheat
```

If the merged job still has fewer than 5 substantive slots, top up with the matching `--resume latest` command.

## User-Rejected Infra Artifacts

Use `trial-user-reject.sh` only when a single slot is clearly an infra/tooling artifact and you want to keep an auditable note instead of silently deleting it:

```bash
scripts/trial-user-reject.sh tasks/<task-slug> \
  --trial <trial-id> \
  --reason "API retry storm before meaningful task work"
```

Good reasons include:

- API retry storm before meaningful task work.
- No-tool-use hang before the task is attempted.
- Setup/OOM failure.
- Agent wrapper error.
- Stale 32K/64K Claude Code output-ceiling configuration.
- True Claude Code per-response output-ceiling crash before coherent task engagement.

Do not user-reject:

- Ordinary `stop_reason: max_tokens`.
- Normal model token-budget exhaustion.
- A long 128K planning/reasoning spiral that spent the agent budget failing, when `reward.txt` exists.
- Timeouts or token issues after the agent made meaningful edits, tests, or debugging progress.

After a user-reject:

```bash
scripts/check-trial-signal.sh tasks/<task-slug> --kind regular
scripts/trial.sh tasks/<task-slug> --resume latest
```

For cheat trials, use `--kind cheat` and `scripts/cheat-trial.sh ... --resume latest`.

## Why Concurrency 1 Helps

`trial.sh` defaults to Harbor concurrency 3. That is a balance between speed and avoiding setup pressure.

Use `--concurrency 1` when setup failures dominate:

```bash
scripts/trial.sh tasks/<task-slug> --concurrency 1
scripts/cheat-trial.sh tasks/<task-slug> --concurrency 1
```

This serializes installs and trial setup. It often helps with low Docker memory, install-stage OOMs, rate limits, and flaky network/DNS behavior. It does not make an underspecified or too-easy task better; it only reduces infrastructure noise.

## Regular Trial Signal

`scripts/check-trial-signal.sh` is read-only. It reports the latest regular or cheat trial job.

For submission:

- Regular trial needs at least 5 substantive runs.
- Cheat trial needs at least 5 substantive runs.
- Regular trial pass rate must be below 80%, unless you intentionally submit with `scripts/submit.sh ... --allow-trivial`.
- The target regular-trial band is 0-40% pass. 40-<80% is borderline. 80% or higher usually means too easy.
- Cheat trial pass rate is not the difficulty gate. Read the cheat trial analysis for anti-cheat failures.

Substantive means `verifier/reward.txt` exists and the slot is not excluded by `.user-reject.md`.

## Final Readiness

Before submit, you should have:

- `scripts/preflight.sh tasks/<task-slug>` has no `FAIL` items.
- `scripts/validate.sh tasks/<task-slug>` passes.
- `scripts/check-quality.sh tasks/<task-slug>` has been run and reviewed.
- `scripts/trial.sh tasks/<task-slug>` has produced a regular `trial-analysis.md`.
- `scripts/cheat-trial.sh tasks/<task-slug>` has produced a cheat `trial-analysis.md`.
- `scripts/check-trial-signal.sh tasks/<task-slug> --kind regular` passes.
- `scripts/check-trial-signal.sh tasks/<task-slug> --kind cheat` passes.
- User-rejected slots, if any, have clear `.user-reject.md` reasons.

Then:

```bash
scripts/submit.sh tasks/<task-slug>
```

`submit.sh` reruns validation, quality review, artifact checks, trial-signal checks, packaging, and validation from the extracted tarball.

## Decision Table

| Symptom | Likely meaning | Run | Do not |
|---|---|---|---|
| `docker ps` fails or hangs | Docker daemon/setup problem | Start Docker, then `scripts/preflight.sh tasks/<task-slug>` | Edit task files |
| Trial setup fails before agent work | Infra/tooling or environment setup problem | Read `job.log`, try `--concurrency 1`, then resume | Treat it as task difficulty |
| DNS errors for `claude.ai`, `downloads.claude.ai`, `deb.debian.org`, npm, or apt | Network disabled or flaky | `scripts/preflight.sh tasks/<task-slug>`; keep top-level `[environment] allow_internet = true` | Set top-level `allow_internet = false` for normal tasks |
| `check-trial-signal.sh` says missing reward | Verifier did not produce a score | Inspect logs, fix setup if needed, then resume with the matching `trial.sh` or `cheat-trial.sh` command | Count the slot as substantive |
| Fewer than 5 substantive regular runs | Not enough regular trial signal | `scripts/trial.sh tasks/<task-slug> --resume latest` | Submit |
| Fewer than 5 substantive cheat runs | Not enough cheat trial signal | `scripts/cheat-trial.sh tasks/<task-slug> --resume latest` | Submit |
| One slot is clearly API/OOM/wrapper failure before work | Auditable infra/tooling reject | `scripts/trial-user-reject.sh ... --trial <id> --reason "..."` then top up | Delete the slot silently |
| Agent hit ordinary `stop_reason: max_tokens` | Agent spent its budget failing | Keep the slot substantive if reward exists | User-reject it |
| 128K planning spiral with reward | Failed-agent signal, weak by itself for difficulty crux | Read trial analysis; inspect scope/ambiguity if repeated | User-reject by default |
| Timeout after meaningful edits/debugging | Trial signal; maybe timeout too low | Read `low_timeout` analysis; adjust timeout only if warranted | Mark as infra artifact |
| Regular pass rate is 80% or higher | Likely too easy | Harden task or submit intentionally with `--allow-trivial` after review | Ignore the gate |
| `trial-analysis.md` missing from the latest Harbor job but trial dirs exist | Analysis did not finish or old artifacts are confusing | `scripts/trial.sh tasks/<task-slug> --resume latest --analyze-only` | Launch full new trials just for analysis |
| Multiple partial jobs from interruptions | Signal split across jobs | `scripts/merge-trial-runs.sh tasks/<task-slug>`, then analyze-only | Manually copy random trial folders |
