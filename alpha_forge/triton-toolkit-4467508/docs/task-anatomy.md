# Task Anatomy — The Five Files

A terminal-based task is a folder with exactly five components. Harbor reads them in a specific order and each file has a narrow purpose. This doc walks through each one.

```
tasks/<task-slug>/
├── task.toml             Metadata + resource config
├── instruction.md        The prompt shown to the agent
├── environment/
│   └── Dockerfile        The container the agent runs in
├── solution/
│   └── solve.sh          The oracle — proves the task is solvable
└── tests/
    ├── test.sh           Bootstrap: prepares verifier deps, runs tests, writes reward.txt
    └── test_outputs.py   The verifier — pytest assertions on task completion
```

---

## `task.toml`

Metadata and resource configuration. Evaluated by rubric criteria `task_toml_schema`, `category`, `task_name`, `resource_configuration`, and `expert_time_estimate`.

### Required metadata fields

```toml
[metadata]
category = "..."
expert_time_estimate_hours = 2.0
```

- **`category`** — primary domain of the task. Use exactly one of `software_engineering`, `system_administration`, `security`, `scientific_computing`, `data_science`, `machine_learning`, or `other`. Prefer the closest named category when one reasonably fits; `other` is valid only as a last resort when none of the named domains accurately describe the task.
- **`expert_time_estimate_hours`** — best-case hours for a focused domain expert who knows the answer. Used to sanity-check difficulty against the agent timeout.

### Resource config

The scaffold ships with reasonable defaults that suit most tasks:

```toml
[verifier]
timeout_sec = 600.0

[agent]
timeout_sec = 18000.0

[environment]
build_timeout_sec = 6000.0
cpus = 2
memory_mb = 4096
storage_mb = 10240
gpus = 0
allow_internet = true
```

Tune only the fields your task actually needs to change:

- **`[verifier] timeout_sec`** — how long the test suite may run.
- **`[verifier] environment_mode`** — leave unset for normal tasks. For advanced TB3-style offline verification, set `environment_mode = "separate"` and add a `[verifier.environment]` section.
- **`[agent] timeout_sec`** — how long the agent may run. Hard tasks can run for hours.
- **`[environment] build_timeout_sec`** — Docker build cap. Raise if apt/pip/git installs take longer.
- **`[environment] cpus`** — bump for parallel/compute-heavy workloads.
- **`[environment] memory_mb`** — bump for large in-memory datasets.
- **`[environment] storage_mb`** — bump for tasks that build or generate big artifacts.
- **`[environment] gpus`** — 0 or 1. Set to 1 for ML training/inference tasks.
- **`[environment] allow_internet`** — keep `true` for normal toolkit tasks. This is the agent environment, and Harbor's `claude-code` setup installs runtime tooling from the network before the task is attempted. Top-level `allow_internet = false` can make regular and cheat trials fail before the agent reads `instruction.md`; the toolkit static checks reject it.
- **`[verifier.environment] allow_internet`** — advanced TB3-style offline verification only. Keep top-level `[environment] allow_internet = true`, set `[verifier] environment_mode = "separate"`, add a vendored verifier image such as `tests/Dockerfile`, and set `[verifier.environment] allow_internet = false`. The verifier `tests/test.sh` must not run runtime downloads or package installs.
- **Root-level `artifacts = [...]`** — advanced transfer surface for separate verifier tasks. Use it when the verifier must read a file produced by the agent or captured from a sidecar, for example `artifacts = ["/app/output.json"]`. Harbor copies declared artifacts into a separate verifier at the same absolute source paths, so the verifier should read `/app/output.json`, not a host-side destination path. Files written under `/logs/artifacts/` are collected automatically and are also available to separate verifiers.

Don't invent new fields; `task_toml_schema` check will reject them.

TB3-style offline verifier pattern:

```toml
[verifier]
timeout_sec = 600.0
environment_mode = "separate"

[verifier.environment]
build_timeout_sec = 600.0
cpus = 1
memory_mb = 2048
storage_mb = 10240
gpus = 0
allow_internet = false

[environment]
# Agent environment stays online so claude-code/codex/other agent setup works.
allow_internet = true
```

Keep difficulty intellectual, not just computational. Trial and cheat-trial run many agent attempts, so a task where every attempt must train a model for hours, run a large simulation, or brute-force a search space can validate cleanly but become impossible to calibrate within the project time budget. For ML, optimization, simulation, and search tasks, prefer frozen artifacts, small deterministic fixtures, bounded rollouts, or hidden verifier probes that test the reasoning/result rather than requiring long training in every trial.

---

## `instruction.md`

The prompt the agent sees. Evaluated by `instruction_concision`, `outcome_verified`, `test_instruction_alignment`, `structured_data_schema`.

### Rules

- **Absolute paths** for every file reference: `/app/output.txt`, not `output.txt`. CI rejects relative paths.
- **State the goal, not the procedure**. "Produce a CSV with columns X, Y, Z" — not "first run this, then run that". The agent picks the approach.
- **Keep it concise**. 2–3 paragraphs is a good target. Workers are often tempted to over-specify; the rubric will penalize it.
- **No AI preamble, no roleplay.** Don't start with "You are a helpful assistant." Write this yourself, don't paste LLM-generated text.
- **If you expect structured output, specify the schema.** Every field, every type. Don't leave it at "output a JSON file."

### Write this file yourself

The rubric criterion `instruction_concision` explicitly penalizes AI-written instructions. They read differently than human-written ones: too much boilerplate, too much hedging, too much structure. Write in your own voice.

### Common spec defects (and how to avoid them)

These are the five patterns that most often cause submissions to be rejected at admin review. Each one looks fluent on first read but introduces ambiguity that the verifier silently disambiguates against the agent's natural reading. The trial agent fails for the wrong reason, and the task ships looking like it has interesting difficulty when really it has a spec defect.

**1. Bivalent phrasing — wording that admits two reasonable readings.**

> Bad: *"Return a sorted list of records."*
> The verifier accepts only ascending order. An agent that returns descending order fails despite producing a "sorted list."

> Better: *"Return a list of records sorted ascending by `timestamp`."*
> Specify the order and the key.

**2. Precondition vs. rejection contract — telling the agent input will be valid, then testing the agent on invalid input.**

> Bad: *"The input will be a valid GeoJSON FeatureCollection of polygons."* paired with a test named `test_degenerate_polygon_rings_are_rejected` that requires the agent's program to exit non-zero on malformed polygons.
> The agent reads "will be valid" as a guarantee from the harness and writes a solver that trusts the input. The test then fails them on malformed data.

> Better: *"The input is a GeoJSON FeatureCollection. Reject malformed polygons (degenerate rings, fewer than four coordinate pairs, zero area) by exiting non-zero. Otherwise produce the output described below."*
> State the rejection contract explicitly when the agent is supposed to enforce it.

**3. Phantom verification claims — confident statements about what the verifier does that aren't actually in the test surface.**

> Bad: *"The verifier replays each transaction on a fresh fork and rejects any solution where balanceOf returns zero."* — when `tests/test_outputs.py` does neither.
> The agent builds a solution to satisfy promised checks that never run. Worse, the verifier accepts solutions that violate the stated contract because the contract isn't tested.

> Better: Only describe verification machinery that exists in `tests/`. If you want a check, write the check in the test file before mentioning it in the instruction.

**4. Phantom requirements — references to bugs, behaviors, or files that don't actually exist in the seed environment.**

> Bad: *"The patcher currently skips articles linking to /the-receipts/. Fix this so all articles are patched."* — when nothing in the seed environment skips those articles in the first place.
> The agent hunts for code that doesn't exist, gets confused, and fails for an unrelated reason.

> Better: Read your own seed environment top to bottom before writing the instruction. Every behavior the instruction names — to fix, to preserve, to extend — must actually be present.

**5. Domain-term mismatches — using a term in a way that diverges from how the test computes it.**

> Bad: *"Parse the CSV at `/app/input.csv`."* — when the file is semicolon-delimited, not comma-delimited.
> A careful agent reads "CSV" as comma-delimited (per RFC 4180) and uses a CSV parser, then fails on the semicolons.

> Better: Either change the file to be actually comma-delimited, or write *"Parse the semicolon-delimited file at `/app/input.csv` (the extension is misleading; the data uses ';' as the column separator)."*
> Match the term to the data, or call out the mismatch.

If your instruction has any of these patterns, expect `scripts/check-proposal.sh` to flag them and trial agents to fail for the wrong reasons.

---

## `environment/Dockerfile`

The container the agent starts in. Evaluated by `environment_hygiene`.

### Rules

- **No pinned apt versions**. `pkg=1.2.3` fails CI — apt repositories drift.
- **`apt-get update` before install.**
- **`rm -rf /var/lib/apt/lists/*` after install.**
- **Do NOT copy the task's top-level `tests/` or `solution/`** into the image. They arrive through Harbor's verifier/oracle paths, not the agent image. Ordinary project tests nested under `environment/**/tests/` are allowed when they are part of the seed codebase the agent should inspect or run.
- **Test-only deps go in `tests/test.sh`**, not here. The Dockerfile should ship only what the *agent* needs. The exception is advanced TB3-style offline verification, where verifier-only deps belong in a separate `tests/Dockerfile` or verifier image, not in `environment/Dockerfile`.
- **Set `WORKDIR /app`.** All task I/O happens here by convention.

### Typical structure

```dockerfile
FROM ubuntu:24.04

WORKDIR /app

RUN apt-get update && apt-get install -y \
        curl \
        git \
    && rm -rf /var/lib/apt/lists/*

COPY data /app/data
```

If you need reference data (large files, seed inputs), put them in `environment/data/` and `COPY` them into `/app/`.

---

## `solution/solve.sh`

The oracle — a reference implementation that proves the task is solvable and the tests are well-formed. Evaluated by `solvable` and `solution_quality`.

### Rules

- **Must genuinely solve the task.** No hardcoded outputs that happen to match expected test values. The rubric criterion `solution_quality` explicitly flags this.
- **Keep it short.** If the solution exceeds ~20 lines, factor into `solution/solve.py` (or `solve.js`, etc.) and call from `solve.sh`.
- **Must pass when run by Harbor's `oracle` agent**, producing `reward.txt = 1`. `validate.sh` enforces this.

### What it's for

Harbor runs `solve.sh` using the special `oracle` agent during `harbor run -a oracle`. It proves two things at once:

1. The task CAN be solved.
2. The tests actually validate a correct solution (not just reject anything).

If your tests pass for the oracle but fail for all real agents, it means your tests are correct and your task is genuinely hard. If your tests fail for the oracle, something's wrong — either the oracle is buggy or the tests over-specify what "correct" looks like.

---

## `tests/test_outputs.py`

The verifier. Pytest assertions that run after the agent finishes. Evaluated by `verifiable`, `anti_cheat_robustness`, `functional_verification`, `essential_difficulty`, `deterministic_reproducible`, `test_instruction_alignment`.

### Rules

- **Check behavior, not source code.** Don't grep the agent's files for specific patterns — check what they DO. The rubric criterion `functional_verification` explicitly forbids string-matching source code.
- **Every test should trace to a named requirement in `instruction.md`.** The `test_instruction_alignment` criterion enforces this by inspection.
- **Assume the agent is adversarial.** Agents run as root inside the container. They can fake tool wrappers, tamper with files in `/app/`, monkey-patch libraries. Design tests that survive that.
- **Use docstrings on every test function.** The test name goes to the log; the docstring goes to the rubric review.
- **Deterministic.** If the task has stochastic elements, use tolerance bounds and justify them in a comment next to the assertion. Or run N trials and check a statistical property.

### Anti-cheat design moves

- **Hidden test inputs.** Don't put `expected.json` in `/app/`; the agent can read and fabricate matching output. Put it in `/tests/expected.json`, which the agent can't see.
- **Content correctness over existence.** `assert path.exists()` is weak; the agent can create an empty file. Read contents and validate.
- **Behavior-over-N inputs.** If the agent wrote a function, run it against multiple inputs and check outputs, rather than grep the function body.
- **Stateful services need adversarial checks.** Agents run as root and can edit local databases, queues, caches, config files, and service state directly. If your task uses SQLite/Postgres/Redis, a web service, a daemon, or any persisted state, the verifier should reset or snapshot state, inject hidden post-session inputs, and check semantic invariants or audit logs rather than trusting the final mutable rows/files.
- **Do not rely on "the agent should not touch X."** If a root agent can write `X`, assume a cheat trial will try. Put held-out checks under `/tests/`, recreate trusted state during verification, or make the verifier compare against data the agent could not have known.
- **Separate verifier transfer is explicit.** A separate verifier does not automatically see the whole agent `/app` tree. If it must grade an agent-produced file or runtime evidence, have the agent publish it under `/logs/artifacts/` or declare a root-level `artifacts = [...]` path in `task.toml`. Harbor re-materializes declared artifacts in the verifier at their original absolute paths.

See `docs/rubric.md` for the full list of criteria and their guidance.

---

## `tests/test.sh`

The bootstrap that launches pytest. Evaluated by `check-test-sh-sanity.sh` static check.

The scaffolded version is usable as-is for most tasks. It:

1. Installs `curl`, then `uv`, then pytest + pytest-json-ctrf via `uvx`.
2. Runs pytest on `test_outputs.py`, emitting CTRF JSON to `/logs/verifier/ctrf.json`.
3. Writes `/logs/verifier/reward.txt`: `1` if all tests pass, `0` otherwise.

This default bootstrap requires internet access during validation and verifier runs. Do not set top-level `[environment] allow_internet = false`; that also disables agent setup and can make regular/cheat trials die before the task starts. If you need TB3-style offline verification, keep the agent environment online, set `[verifier] environment_mode = "separate"`, vendor verifier dependencies into `tests/Dockerfile` or a prebuilt verifier image, set `[verifier.environment] allow_internet = false`, and make `tests/test.sh` run pytest directly without `curl`, `apt-get`, `pip install`, `uvx --with`, or similar runtime installs.

### uvx runs pytest in an isolated venv

`uvx` creates a fresh, isolated venv for each invocation and **does NOT inherit the container's site-packages**. Every non-stdlib import in `test_outputs.py` must be declared via `--with <pkg>` in `test.sh`, even if the Dockerfile already `pip install`s the package for the agent.

If `test_outputs.py` imports `requests` and `numpy`, the uvx block looks like:

```bash
uvx \
  --with pytest==8.4.1 \
  --with pytest-json-ctrf==0.3.5 \
  --with requests \
  --with numpy \
  pytest --ctrf /logs/verifier/ctrf.json /tests/test_outputs.py -rA
```

A `ModuleNotFoundError` during pytest **collection** (before any test runs) is almost always a missing `--with`, not a bug in your test. Packages with optional backends need the backend declared too — e.g., `transformers` alone leaves `AutoModelForSequenceClassification.from_pretrained(...)` failing with "requires the PyTorch library but it was not found"; add `--with torch` to fix.

The static check `refs/ci_checks/check-test-imports.sh` scans `test_outputs.py` and warns on likely-missing `--with` declarations. It's advisory (always exits 0) because the import-name ↔ pip-name map is inherently imperfect; use your judgement.

### System packages

If you need a system binary the verifier invokes (e.g., `stockfish` for a chess task), add an `apt-get install` before the uvx call. Keep changes minimal and add a comment explaining why. Test-only Python packages belong in `--with` declarations; test-only system packages belong in an `apt-get install` line.
