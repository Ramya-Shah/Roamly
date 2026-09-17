"""
The verifier. Replace the example tests below with assertions that check
whether the agent solved your task. Full guidance: docs/task-anatomy.md →
tests/test_outputs.py section.

Each test:
  - needs a docstring (it surfaces in the rubric review)
  - should check behavior (file contents, runtime state), not source patterns
  - should trace to a named requirement in instruction.md
  - must survive an adversarial agent (agents run as root in /app/)

Non-stdlib imports: declare each one with `--with <pkg>` in tests/test.sh.
uvx runs pytest in an isolated venv that does not see container site-packages,
so a `ModuleNotFoundError` at pytest collection time means a missing `--with`
declaration, not a bug in your tests.
"""

from pathlib import Path


def test_done_file_exists():
    """The expected output file is created."""
    assert Path("/app/done.txt").exists(), "/app/done.txt does not exist"


def test_done_file_content():
    """The output file has the expected content."""
    content = Path("/app/done.txt").read_text().strip()
    assert content == "done", f"Expected 'done', got {content!r}"
