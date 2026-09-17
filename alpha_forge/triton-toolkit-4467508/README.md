# Terminal-Based Task Authoring Toolkit

Worker-facing toolkit for authoring terminal-based tasks. Ships a dev container, scaffolds, and wrapper scripts that take a task from idea to a validated, quality-reviewed, difficulty-calibrated, cheat-resistant tarball ready for upload.

## Start here

- **Worker onboarding:** `docs/README.md`
- **The 5-file task format:** `docs/task-anatomy.md`
- **The 25-criterion quality rubric:** `docs/rubric.md`

## Directory map

```
toolkit/
├── .devcontainer/     Linux environment (Docker CE CLI + uv + harbor + claude)
├── scaffold/          Canonical 5-file task skeleton
├── tasks/             Your work area — one folder per task authored
├── submissions/       Tarballs produced by submit.sh (your deliverables)
├── scripts/           Wrappers: check-proposal, new-task, validate, check-quality, trial, cheat-trial, trial-user-reject, merge-trial-runs, submit, clean
├── refs/              Rubrics, CI checks, hostile prompt
└── docs/              Worker-facing documentation
```

## Worker flow

```bash
npx @devcontainers/cli up                     # build/start the container
npx @devcontainers/cli exec bash              # enter it
scripts/new-task.sh <task-slug>                    # scaffold

# Edit tasks/<task-slug>/instruction.md with your task idea, then:
scripts/check-proposal.sh tasks/<task-slug>        # 6-criterion rubric → .proposal-review.md
# iterate on instruction.md until the Decision is Accept

# Fill in the remaining files (task.toml, Dockerfile, solve.sh, test_outputs.py), then:
scripts/validate.sh tasks/<task-slug>              # static + oracle + nop
scripts/check-quality.sh tasks/<task-slug>         # 25-criterion rubric → .rubric-review.md
scripts/trial.sh tasks/<task-slug>                 # writes trial-analysis.md
scripts/cheat-trial.sh tasks/<task-slug>           # adversarial, writes trial-analysis.md
scripts/submit.sh tasks/<task-slug>                # produces submissions/<task-slug>-<ts>.tar.gz
# → upload the tarball through the collection platform
```

Steps `validate → check-quality → trial → cheat-trial` are an iteration loop. See `docs/README.md` for full detail.
