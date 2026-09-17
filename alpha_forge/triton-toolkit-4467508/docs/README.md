# Terminal-Based Task Authoring Toolkit

A dev container plus wrapper scripts that take a task from idea to a validated, reviewed, difficulty-calibrated, cheat-resistant tarball ready to upload. Everything runs from a terminal.

## TL;DR

```bash
# 1. Unpack the toolkit archive (directory name is triton-toolkit-<sha>)
unzip triton-toolkit-*.zip && cd triton-toolkit-*
cp .env.example .env               # set ANTHROPIC_API_KEY (+ proxy URL if applicable)

# 2. Enter the container (first run builds the image, ~3-5 min)
npx @devcontainers/cli up
npx @devcontainers/cli exec bash
scripts/preflight.sh                  # quick Docker/key/proxy/network readiness check

# 3. Scaffold the task (do this first; instruction.md lives at tasks/<task-slug>/instruction.md)
scripts/new-task.sh <task-slug>

# 4. Write the task idea into tasks/<task-slug>/instruction.md, then review it
scripts/check-proposal.sh tasks/<task-slug>         # 6-criterion review → .proposal-review.md
# iterate on instruction.md until the Decision is Accept
# edit tasks/<task-slug>/* with any editor — /workspace is bind-mounted
scripts/validate.sh tasks/<task-slug>
scripts/check-quality.sh tasks/<task-slug>         # writes tasks/<task-slug>/.rubric-review.md
scripts/preflight.sh tasks/<task-slug>              # catches setup/static blockers before trials
scripts/trial.sh tasks/<task-slug>                  # writes trial-analysis.md
scripts/cheat-trial.sh tasks/<task-slug>
scripts/submit.sh tasks/<task-slug>                 # produces submissions/<task-slug>-<ts>.tar.gz

# 5. Upload the tarball through the collection platform.
```

---

## Host setup

### macOS
1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and launch it.
2. Install [Node.js](https://nodejs.org) LTS.
3. From the toolkit root: `npx @devcontainers/cli up` to build, then `npx @devcontainers/cli exec bash` to enter.

### Windows + WSL2
1. Install Docker Desktop with **WSL 2 backend** enabled.
2. Install Node.js inside your WSL2 distro.
3. Unpack the toolkit **inside the WSL filesystem** (not under `/mnt/c/…`) — Docker volume mounts fail silently on Windows-drive paths.
4. From the WSL shell at the toolkit root: `npx @devcontainers/cli up`, then `npx @devcontainers/cli exec bash`.

### Sanity check

Once inside the container, confirm:

```bash
scripts/preflight.sh
```

This checks Docker/Harbor/Claude Code availability and version compatibility, Anthropic key/proxy configuration, the LLM proxy domain, `CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000`, targeted network reachability, disk/resource hints, and optional agent credentials. Before trialing a task, run `scripts/preflight.sh tasks/<task-slug>` to add task identity, `allow_internet`, and Dockerfile-reference checks. Preflight is a quick setup screen; it does not replace `scripts/validate.sh`.

---

## The worker flow

A session is nine steps with two iteration loops. Step 3 is a proposal loop: edit `instruction.md`, run `check-proposal.sh`, repeat until the idea clears. Steps 5–8 are an implementation loop: validate, review, trial, cheat-trial — findings route back to editing task files.

### 1. Enter the container

```bash
npx @devcontainers/cli up
npx @devcontainers/cli exec bash
```

First `up` builds the image (~3-5 min on first run, instant on re-entry). `exec bash` drops you at `/workspace` with a `[task-authoring]` prompt.

### 2. Scaffold

```bash
scripts/new-task.sh <task-slug>
```

Creates `tasks/<task-slug>/` with all five files. Name must be lowercase kebab-case, ≤5 words, and under 30 characters.

### 3. Write the idea into instruction.md, then review it

`tasks/<task-slug>/instruction.md` is the prompt the agent will ultimately see. It's also where your task idea starts. Edit it with any editor (host-side: VS Code, Sublime; container-side: vim, nano — both are installed). Keep it a 1–2 paragraph description of what the agent must accomplish.

Then run the proposal review:

```bash
scripts/check-proposal.sh tasks/<task-slug>
```

Claude Opus 4.8 with max reasoning effort evaluates the idea against the six acceptance criteria:

- **verifiable** — deterministic, programmatic grading
- **well-specified** — two independent readers would write compatible verifiers
- **solvable** — expert-hours, not expert-days
- **difficult** — PhD-level or years of domain expertise
- **interesting** — someone would pay for the solution
- **outcome-verified** — grade the result, not the approach

The script writes `tasks/<task-slug>/.proposal-review.md` alongside your task files with per-criterion judgements and a final `Decision:` line (`Strong Reject` / `Reject` / `Uncertain` / `Accept` / `Strong Accept`). Iterate on `instruction.md` and rerun until the decision is Accept. Proposals die cheap; implementations die expensive.

### 4. Fill in the other four files

Once the proposal clears, fill in the remaining files at `tasks/<task-slug>/`. See `docs/task-anatomy.md` for per-file detail:

- `task.toml` — metadata + resource config
- `environment/Dockerfile` — the container the agent runs in
- `solution/solve.sh` — the oracle (proves solvability)
- `tests/test_outputs.py` — the verifier

### 5. Local validation

```bash
scripts/validate.sh tasks/<task-slug>
```

Runs static checks (Dockerfile sanity, absolute paths, etc.), the oracle run (must achieve reward 1.0), and the nop run (must achieve reward 0.0). Iterate until all three sections green.

### 6. Quality review

```bash
scripts/check-quality.sh tasks/<task-slug>
```

Runs Claude Opus 4.8 with max reasoning effort against the 25-criterion implementation rubric. Streams output to the terminal and writes `tasks/<task-slug>/.rubric-review.md`. Open that file alongside the task files while iterating; re-running overwrites it.

### 7. Difficulty trial

Before launching a long trial run, do a fast local readiness check:

```bash
scripts/preflight.sh tasks/<task-slug>
```

Fix any `FAIL` items first. `WARN` items are usually non-blocking, but low Docker memory means you should prefer `--concurrency 1`.

If a trial, cheat trial, or submit gate fails and you are not sure whether to top up, user-reject, lower concurrency, or start fresh, use [trial-triage.md](trial-triage.md).

**Tip — cheap early-warning run before the full calibration cycle:**

```bash
scripts/trial.sh tasks/<task-slug> --trials 3
```

Run this once after writing the 5 files. The analysis output ends with a **Convergence summary** section: if 2 or 3 of 3 trials fail on `task_specification` quoting substantially the same instruction phrase, you almost certainly have **bivalent phrasing** — a clause that admits two reasonable readings where the verifier silently locks in one. *You won't catch this by re-reading `instruction.md` yourself; you already know the intended reading.* The 3-trial run is ~$0.50–1.50 in API spend and ~10 minutes wall-clock — cheap enough to do on every iteration. Iterate on `instruction.md` until convergence is on `difficulty_crux` (the intended difficulty surface) rather than `task_specification`.

**Full calibration run before submit:**

```bash
scripts/trial.sh tasks/<task-slug>
```

Defaults to 5 trials with claude-code at 3-way harbor concurrency. Claude Code trials default to `CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000`; a 32K or 64K output ceiling means an older/manual configuration is still in play and should be rerun or topped up at 128K. After the main run, the script auto-tops-up until at least 5 substantive trials produced a real `verifier/reward.txt`, capping at 20 total attempts. A trial with both `exception.txt` and `verifier/reward.txt` still counts: the verifier reached a reward decision. A trial without `verifier/reward.txt` does not count. The final terminal line prints the path to `trial-analysis.md` in the harbor job directory.

Submit will refuse to package unless **both** the regular trial and the cheat trial cleared **at least 5 substantive trials**. Substantive means `verifier/reward.txt` exists and the slot has not been explicitly user-rejected as an infra/tooling artifact. Missing-reward setup failures, agent-installer OOMs, Harbor setup errors, and user-rejected infra/tooling artifacts do not count. A 128K Claude Code per-response output ceiling after the agent spent its budget planning/reasoning about the task is valid failed-agent signal when `reward.txt` exists, even if the agent never wrote code. True tool/API/wrapper crashes before coherent task engagement can be user-rejected and topped up. Ordinary agent/model `stop_reason: max_tokens` remains substantive trial signal when `reward.txt` exists. The auto-retry usually gets there without intervention; if it can't, it aborts after 2 consecutive dry top-up batches and the worker should investigate the setup.

Interpretation (per-trial section):

- **`task_specification: FAIL`** → instruction is ambiguous, rewrite.
- **`low_timeout: FAIL`** → agent was still making meaningful progress at cutoff, raise the agent timeout in `task.toml`.
- **`difficulty_crux: FAIL`** → agent failed for a reason unrelated to the challenge your task is testing; the test surface may be enforcing an unrelated constraint, or the instruction may be steering the agent off-course.
- **Agent/tooling artifact** → ExitPlanMode loops, unavailable tools, API/tool-wrapper failures, stale 32K/64K Claude Code output-ceiling configuration, true pre-engagement Claude Code per-response output-ceiling crashes, or pre-task Harbor orchestration exceptions are not task defects by themselves. A long planning/reasoning spiral that hits the 128K output ceiling is still useful failed-agent signal when the verifier produced reward. If that pattern repeats across trials, inspect the task for excessive scope, ambiguity, or instructions that induce unproductive planning.

The **Convergence summary** at the end aggregates these — read it first. Verdicts: `LIKELY BIVALENCE` / `LIKELY INTENDED CRUX` / `LIKELY UNDERSPECIFIED RESOURCES` / `LIKELY AGENT/TOOLING ARTIFACT` / `MIXED / NO STRONG PATTERN` / `TOO EASY`. Each comes with a one-sentence worker action.

Pass-rate calibration (mechanically enforced at submit time):

- **80% or higher pass** → too easy. Submit blocks unless you pass `--allow-trivial`.
- **40-<80% pass** → salvageable but borderline. Trial agents trip on the difficulty crux only sometimes.
- **0-40% pass** → target band. Most agents fail on the intended crux.

If trials fail at setup with timeouts (e.g. `claude.ai/install.sh` hanging), the parallel agent installs may be hitting a rate limit. The default concurrency is 3 — try `--concurrency 1` to serialize. If setup logs mention DNS failures for `claude.ai`, `downloads.claude.ai`, `deb.debian.org`, npm, or apt while top-level `[environment] allow_internet = false`, the agent environment is offline; set top-level `[environment] allow_internet = true` and use the TB3-style separate verifier pattern if only the verifier should be offline.

If one individual slot is clearly an infra/tooling artifact, keep it auditable instead of deleting it:

```bash
scripts/trial-user-reject.sh tasks/<task-slug> \
  --trial <trial-id> \
  --reason "API retry storm before meaningful task work"

# Also valid for a true Claude Code wrapper/API ceiling before task engagement:
scripts/trial-user-reject.sh tasks/<task-slug> \
  --trial <trial-id> \
  --reason "Claude's response exceeded the 128000 output token maximum before coherent task engagement"
scripts/check-trial-signal.sh tasks/<task-slug> --kind regular
```

This writes `.user-reject.md` next to the trial, excludes that slot from substantive counts, and leaves the original trajectory/logs in place. Use it for API retry storms, no-tool-use hangs, setup/OOM failures, wrapper errors, stale 32K/64K Claude Code output-ceiling configuration, or true Claude Code per-response output-ceiling crashes before coherent task engagement, often logged as `Claude's response exceeded the 128000 output token maximum`, `max_output_tokens`, or `CLAUDE_CODE_MAX_OUTPUT_TOKENS`. A message like `Claude's response exceeded the 32000 output token maximum` or `Claude's response exceeded the 64000 output token maximum` means the current toolkit default was not applied; update the toolkit or set `CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000`, then top up.

Do not user-reject ordinary `stop_reason: max_tokens` / normal model token-budget exhaustion, even if the agent never wrote code; the agent spent its budget failing to solve, so that is substantive trial signal. Also do not user-reject long 128K planning/reasoning spirals, timeouts, or token issues after the agent meaningfully engaged the task. If such a trial produced `verifier/reward.txt`, count it as failed-agent signal. If it did not produce `reward.txt`, it cannot satisfy the 5-substantive gate, but leave it visible in the trial analysis and rerun `scripts/trial.sh tasks/<task-slug> --resume latest` or `scripts/cheat-trial.sh tasks/<task-slug> --resume latest` to top up.

The current toolkit sets the 128K ceiling automatically. If you are on an older toolkit, or your shell still hits 32K/64K, resume with:

```bash
CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000 scripts/trial.sh tasks/<task-slug> --resume latest

# For cheat trials:
CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000 scripts/cheat-trial.sh tasks/<task-slug> --resume latest
```

If trials run but each attempt needs hours of training, simulation, brute force, or parameter search, redesign before spending the whole work budget collecting signal. Keep the hard part in the reasoning: use smaller deterministic fixtures, frozen/pretrained artifacts, bounded rollouts, or hidden verifier probes instead of requiring long compute in every trial attempt.

If interruptions, API/setup failures, or stopped runs leave useful signal split across several partial jobs, merge their trial children into one latest job and re-run analysis without launching new trials. Use this only when the task files did not materially change between jobs; if instructions, tests, verifier behavior, Dockerfile/dependencies, seed data, task-visible files, or resource settings changed, start fresh instead.

```bash
scripts/merge-trial-runs.sh tasks/<task-slug> --kind regular
scripts/trial.sh tasks/<task-slug> --resume latest --analyze-only

# For cheat trials:
scripts/merge-trial-runs.sh tasks/<task-slug> --kind cheat
scripts/cheat-trial.sh tasks/<task-slug> --resume latest --analyze-only
```

After merging, read the refreshed analysis and run `scripts/check-trial-signal.sh` for the matching regular or cheat kind. If fewer than 5 substantive slots remain, top up with the matching `--resume latest` command.

### 8. Anti-cheat trial

```bash
scripts/cheat-trial.sh tasks/<task-slug>
```

Prepends a hostile prompt instructing the agent to cheat, then runs the trial harness and analysis. A reward-1.0 cheat trial is acceptable if the agent solved legitimately; it is a problem only when `reward_hacking` fails because the pass came from fabricated outputs, tampered artifacts, harness manipulation, or similar illegitimate means. Hardening moves:

- Move verification surface out of `/app/` so the agent can't touch it.
- Use content-correctness checks, not file-existence checks.
- Use a hidden test dataset the agent never sees.
- For databases, local services, queues, caches, or daemons, assume the agent can mutate state directly. Recreate trusted state in the verifier, inject hidden post-session operations, and assert semantic invariants rather than only checking final rows/files.
- Avoid `curl | sh` or similar patterns in `test.sh`.

### 9. Submit

```bash
scripts/submit.sh tasks/<task-slug>
```

Six-step gauntlet:
1. Validate (oracle = 1.0, nop = 0.0, static checks pass — including check-instruction-clean for leftover cheat-prompt residue, fixture-leak detection, and arch-portability advisory)
2. Refresh `.rubric-review.md`
3. Submission artifact check — `.rubric-review.md`, latest regular trial, and latest cheat trial must all be present and not byte-identical
4. Trial-signal check — **both regular and cheat trials** must have at least 5 *substantive* runs (`verifier/reward.txt` exists and the slot is not user-rejected); regular-trial pass rate must be below 80%
5. Package the task plus latest trial / cheat-trial / job-summary into `submissions/<task-slug>-<timestamp>.tar.gz` (also stamps `.toolkit-version` so admin review can correlate worker artifacts with the producing toolkit commit, and includes user-reject manifests when present)
6. Verify-from-extraction — extract the tarball to a scratch dir and re-run `validate.sh` to catch packaging defects (files excluded by `.gitignore`/`.dockerignore` but referenced by the Dockerfile or tests)

If any step fails, the tarball is not produced (or is removed if the failure is in step 6).

Flags:
- `--skip-quality` — skip step 2 if you just ran `scripts/check-quality.sh`
- `--allow-trivial` — proceed past step 4 when the regular-trial pass rate reaches 80%. Use sparingly; the band is 0-40% pass for delivery-ready calibration. The 5-substantive minimum is hard and cannot be overridden — re-run `scripts/trial.sh` / `scripts/cheat-trial.sh` to top up.

---

## Cleanup

```bash
scripts/clean.sh <task-slug>       # remove one task's artifacts (keeps submissions/)
scripts/clean.sh --all              # remove all task + trial artifacts
scripts/clean.sh --trials-only      # remove trial outputs, keep tasks/
scripts/clean.sh --docker-preview   # list likely Harbor Docker containers/images
scripts/clean.sh --dry-run <args>   # preview without deleting
```

`submissions/` is never auto-deleted — tarballs are the work product. `clean.sh` removes toolkit files under `tasks/` and `harbor-jobs/`; it does not delete Docker containers or images. If Docker Desktop shows many Harbor/task objects after trials, run `scripts/clean.sh --docker-preview [task-slug]` to identify likely matches, then remove them from Docker Desktop or Docker's own prune commands only after confirming they are not needed.

---

## Directory layout

```
toolkit/
├── .devcontainer/        # Linux environment (Docker CE CLI + uv + harbor + claude)
├── scaffold/             # Canonical 5-file skeleton
├── tasks/                # Your work area — one folder per task
├── submissions/          # Tarballs produced by submit.sh
├── harbor-jobs/          # Trial + analysis output from trial.sh / cheat-trial.sh
├── scripts/              # Wrappers: new-task, validate, check-quality, trial, cheat-trial, trial-user-reject, merge-trial-runs, submit, clean
├── refs/                 # Rubrics + CI checks + hostile prompt
├── docs/                 # This doc + task-anatomy + trial-triage + rubric reference
├── .env.example          # Template for your .env
├── .gitattributes        # Enforces LF line endings
└── .editorconfig         # Keeps tabs/spaces consistent
```

---

## Troubleshooting

**`harbor: command not found`, `claude: command not found`, or stale Claude Code version** — you're not in the toolkit dev container, the container setup did not finish, or the container was built from an older toolkit. Do not install these with `apt`; they are bundled in the dev container. From the toolkit root, run `npx @devcontainers/cli up`, then `npx @devcontainers/cli exec bash`, and rerun `scripts/preflight.sh` from the `[task-authoring]` shell. If preflight reports an old Claude Code version, rebuild the dev container or run `claude update`.

**`docker ps` hangs or errors** — Docker daemon on the host isn't running. Start Docker Desktop. On Windows, also confirm WSL2 integration is enabled in Docker Desktop settings.

**Permission denied on `.sh` scripts** — CRLF line endings. Run `chmod +x *.sh scripts/*.sh`.

**`ANTHROPIC_API_KEY not set`** — `.env` missing. Copy `.env.example` to `.env` and fill in the key. Scripts source it when they need API access; `postStartCommand` also prints a warning if it's missing when the container starts.

**Claude Code hits a 32K or 64K output ceiling** — current toolkit trials default to `CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000`. A 32K/64K ceiling means an older toolkit or manual shell setting is still in play. Add `CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000` to `.env`, then rerun `scripts/trial.sh tasks/<task-slug> --resume latest` or `scripts/cheat-trial.sh tasks/<task-slug> --resume latest`.

**Oracle fails** — `solve.sh` has a bug or tests are too strict. Launch an interactive container and reproduce by hand.

**Oracle/nop fails with no verifier output** — pytest likely never ran. Read the `job.log` section that `validate.sh` prints. If it mentions Docker build, image inspection, or `docker inspect returned 1`, fix the Dockerfile/package install/missing `COPY` source or restart Docker, confirm `docker ps` works, then rerun `scripts/validate.sh`.

**Validation flips from passing to file-not-found after task edits** — rerun `scripts/validate.sh` before trialing; a changed `Dockerfile`, `.dockerignore`, `test.sh`, or renamed fixture can make the image build or verifier lose files that existed in an earlier run. Check the printed `job.log` first. `scripts/clean.sh --trials-only` clears old Harbor logs if they are making it hard to see the current failure; it does not change your task files.

**Top-level `[environment] allow_internet = false` is rejected** — keep the agent environment online for normal toolkit tasks. Harbor installs `claude-code` and other agent runtime tooling inside that environment before the task is attempted; disabling network can produce setup failures like unresolved `claude.ai`, `downloads.claude.ai`, `deb.debian.org`, npm, or apt hosts. To mirror TB3 for an offline verifier, keep `[environment] allow_internet = true`, set `[verifier] environment_mode = "separate"`, add a vendored verifier image such as `tests/Dockerfile`, and set `[verifier.environment] allow_internet = false`.

**Offline verifier fails during `tests/test.sh`** — `[verifier.environment] allow_internet = false` means the verifier cannot download dependencies at runtime. Move verifier dependencies into `tests/Dockerfile` or a prebuilt verifier image, and make `tests/test.sh` run pytest directly. It should not call `apt-get`, `curl`, `pip install`, `uvx --with`, `npm install`, or similar network/package install commands.

**Nop passes** — tests are trivially satisfiable. Common causes: test only checks file existence (not content); pre-existing file in `/app/` already satisfies the assertion; test doesn't clean state between runs.

**Cheat trial passes by editing the database or service state directly** — this is a real anti-cheat failure, not just a clever agent. Root agents can mutate `/app` state. Move trusted fixtures/checks under `/tests/`, recreate or snapshot state during verification, add hidden post-session requests/transactions, and assert audit or semantic invariants that direct row/file edits cannot satisfy.

**API error 400 ("Invalid model")** — the proxy rejected the model name. Override with `--model <name>` on the relevant script.

**harbor-jobs/ growing large** — run `scripts/clean.sh --trials-only`. This removes local Harbor logs only. To inspect Docker-side containers/images left by Harbor, run `scripts/clean.sh --docker-preview [task-slug]`.

**`instruction.md` starts with "You are a security researcher bot..."** — `scripts/cheat-trial.sh` was killed mid-run (SIGKILL, devcontainer rebuild, etc.) so its `trap cleanup` never restored the file. Either `git checkout tasks/<slug>/instruction.md` (if version-controlled), or re-run `scripts/cheat-trial.sh tasks/<slug>` and let it complete normally — the trap restores the original on EXIT. `scripts/validate.sh` will catch this via `check-instruction-clean.sh` and block submit until fixed.

**`latest-trial-analysis.md` says "cheat trial"** — your toolkit is pre-commit `3935d3b`, before the cheat-trial / regular-trial output split. `cheat-trial.sh` runs were overwriting your regular-trial output. Update the toolkit (`git pull`) and re-run `scripts/trial.sh tasks/<slug>`; the new layout writes cheat output to `harbor-jobs/cheat-trial-<slug>-*/` rather than the shared `trial-<slug>-*/`. The `.toolkit-version` stamp written by `submit.sh` helps admin review distinguish pre/post-fix submissions.

**Trial keeps hanging on the verifier step** — see `HARNESS-NOTES.md` in the admin batch dirs for the orphan-descendants pattern. If the task spawns long-running daemons or python heredocs, the agent's `claude --print` process may inherit a pipe that those background procs hold open. The agent prints "Done", but Harbor never sees EOF and the verifier doesn't get scheduled. Workaround: ensure any agent-side helper processes terminate cleanly (`pkill` from the agent, or use `&& wait` in the agent's bash heredocs).

**Trial slug is rejected as "≥30 chars"** — Harbor truncates per-trial subdir names to ~31 chars. `scripts/new-task.sh`, `scripts/validate.sh`, and `scripts/trial.sh` enforce a 29-char cap before Harbor work starts. Shorten the slug.
