# The 25-Criterion Implementation Rubric

This is the 25-criterion implementation rubric, rendered as a human-readable checklist. The authoritative copy is at `refs/rubrics/task-implementation.toml`; this doc is a reference summary.

`scripts/check-quality.sh` runs a Claude Opus 4.8 review with max reasoning effort against every task using this rubric. The review posts **PASS / FAIL / N/A** for each criterion with 2–5 sentences of evidence. Your goal when writing a task: understand each criterion well enough that the rubric passes all 25 on the first or second attempt.

The criteria fall into four clusters. Order matters — core task design first, metadata last, because the first failures rarely make the others worth checking.

---

## Cluster 1: Core Task Design (7)

These are the fundamentals. A failure here usually means the task shouldn't exist in its current form.

| # | Criterion | The question it asks |
|---|---|---|
| 1 | **`verifiable`** | Is the verifier reliable, deterministic, efficient? Programmatic checks, not LLM-as-judge (rare exception with extraordinary justification). |
| 2 | **`solvable`** | Is a working solution provided? Can an expert implement it in hours, not days? |
| 3 | **`difficult`** | Does it require multi-step reasoning, careful state tracking, or non-obvious domain knowledge — the kind of work a competent senior engineer needs to think through? |
| 4 | **`interesting`** | Is there a real-world scenario where someone would get paid to do this? |
| 5 | **`outcome_verified`** | Tests grade end-state, not process. Instructions describe the goal, not steps. No "use vim" or "don't use tool X." |
| 6 | **`anti_cheat_robustness`** | Do tests resist adversarial shortcuts? Agent runs as root; can fake tool wrappers, monkey-patch libraries, cache answers, read solution files. Separate verifiers should use `/logs/artifacts/` or root-level `artifacts = [...]` for agent evidence. |
| 7 | **`task_security`** | No malicious code, credential exfiltration, supply-chain attacks, destructive ops, obfuscation, prompt injection, cross-task interference. |

---

## Cluster 2: Testing & Verification (5)

These cover the design quality of the verifier.

| # | Criterion | The question it asks |
|---|---|---|
| 8 | **`functional_verification`** | Tests check behavior via execution and output — not source-code keyword or string pattern matching. |
| 9 | **`verifier_reward_surface_check`** | The verifier exercises the agent's artifact against inputs/conditions the agent couldn't have anticipated — a plausible stub would NOT pass. In separate verifier mode, declared artifacts are read at the same absolute paths. |
| 10 | **`deterministic_reproducible`** | Runs produce consistent results. Pinned Python deps, no live-service dependencies, no unpinned apt. Stochastic tasks use 100+ trials. |
| 11 | **`essential_difficulty`** | Difficulty comes from reasoning, algorithms, expertise — not formatting minutiae, output precision, or instruction-following volume. |
| 12 | **`test_instruction_alignment`** | Every test traces to a requirement, every requirement is tested, and the natural reading of each requirement matches what the verifier checks (no bivalent phrasing, phantom requirements, or domain-term mismatches). |

---

## Cluster 3: Implementation Quality (8)

These are about the care taken in writing the task.

| # | Criterion | The question it asks |
|---|---|---|
| 13 | **`novel`** | Not a standard textbook exercise or well-known problem. Not reproducible from training corpus memorization. |
| 14 | **`agentic`** | Requires multi-step terminal interaction. Cannot be solved by a single LLM call. Needs observation, adaptation, iteration. |
| 15 | **`reviewable`** | A non-specialist reviewer can verify correctness, or the contributor provides sufficient explanation. Hardcoded expected values are a red flag. |
| 16 | **`instruction_concision`** | Human-written, concise, absolute paths. No AI preamble, roleplay, or boilerplate. |
| 17 | **`solution_quality`** | Solution demonstrates actual computation. Not hardcoded answers. Files >20 lines live as separate files, not heredocs. |
| 18 | **`environment_hygiene`** | No top-level verifier tests or solution in the agent image. Project tests nested under `environment/**/tests/` are OK when they are seed-code tests. Test-only deps in test.sh, except vendored separate verifier images for offline verification. Apt properly managed. |
| 19 | **`structured_data_schema`** | If structured output is expected, the exact schema is documented in the instruction or a referenced spec file (not just examples). |
| 20 | **`typos`** | No typos in filenames, paths, commands, variable names, JSON field names. |

---

## Cluster 4: Metadata (5)

These cover the metadata fields and resource config.

| # | Criterion | The question it asks |
|---|---|---|
| 21 | **`category`** | Category accurately reflects the primary domain of the task. `other` is valid only as a last resort when no named category reasonably fits. |
| 22 | **`task_name`** | Descriptive, specific, at most 5 kebab-case words, and under 30 characters. Not generic, vague, or misleading. |
| 23 | **`resource_configuration`** | Timeouts and resources match needs. Difficulty comes from reasoning, not compute intensity. |
| 24 | **`expert_time_estimate`** | Provided, non-zero, plausible given difficulty. Consistent with the agent timeout. |
| 25 | **`task_toml_schema`** | Only valid Harbor fields in `task.toml`. Root-level `artifacts = [...]` is valid; invented fields (`skills`, `prerequisites`, `estimated_difficulty`, etc.) are not. |

---

## How the rubric review runs

`scripts/check-quality.sh` invokes:

```bash
claude --print \
    --model claude-opus-4-8 \
    --effort max \
    --allowed-tools "Read,Glob,Grep" \
    --append-system-prompt "<refs/rubrics/task-implementation.toml>" \
    "<instructions to evaluate all 25 criteria>"
```

Claude loads the rubric as its system prompt, reads every file in the task directory with Read/Glob/Grep, and emits per-criterion verdicts with evidence citing specific file paths and line numbers. Output streams to the terminal and writes to `tasks/<task-slug>/.rubric-review.md`.

The review is a recommendation, not a gate — it helps you find issues before submitting, but every criterion is ultimately a judgment call.

---

## Common failure modes and what to do

- **`outcome_verified` fails** → check `instruction.md` for procedure words ("first", "then", "use tool X"). Rewrite to state the goal and leave the method to the agent.
- **`functional_verification` fails** → look for `grep`, `in file.read()`, or string-matching in `test_outputs.py`. Replace with actual execution + output checks.
- **`instruction_concision` fails** → instruction reads as LLM-generated. Rewrite it yourself in plain language.
- **`task_toml_schema` fails** → you invented a field. Remove or rename to a valid Harbor field. `artifacts = [...]` is a valid root-level Harbor field for transferring agent-produced evidence into a separate verifier.
- **`anti_cheat_robustness` fails** → tests are fooled by fabricated outputs or mutable state. Add content-correctness checks, move verification surface out of `/app/`, reset/snapshot databases or service state in the verifier, and run `scripts/cheat-trial.sh` to see what breaks.
- **`novel` fails** → the task is a well-known exercise. Add constraints, combine problems, use less-common tools, or pick a different idea.

---

## When a criterion legitimately doesn't apply

Some criteria are N/A rather than failing:

- **`structured_data_schema`** — N/A if the task has no structured output (e.g., "modify a text file").
- Others depend on the task shape.

The rubric review distinguishes N/A from FAIL. Don't force-pass criteria that don't apply; mark them N/A and move on.
