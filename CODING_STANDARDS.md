# Coding standards

Judgment rules for reviewers. Each is one sentence a reviewer can answer yes or no to, then its reason. Rules a tool checks are under "Mechanical rules", not here. These standards start small and grow: a rule is added when a review or a retrospective shows it's needed.

## Platform

Use what the stack provides; each rule comes from a "Platform Capabilities" row in `specs/shape-check-7/architecture.md`.

- Use Python 3.12 `dict`'s `pop(key[, default])`, called without a default, for removing an entry by key; don't hand-roll a membership check, a `raise KeyError`, a `del` and a separate lookup — [finding](specs/shape-check-7/research/python-dict-pop.md).
- Use Python 3.12 `dict`'s preserved insertion order for keeping the to-dos in the order they were added; don't hand-roll re-sorting by id or a separate order list — [finding](specs/shape-check-7/research/python-dict-pop.md).

## Structure

- The public interface is exactly what `src/testbed/__init__.py`'s `__all__` exports plus the public methods of those classes, and a story grows it only by what its spec names — a small interface keeps the module deep.
- `TodoList._items` and `_next_id` are the module's storage, hidden behind its methods, and only `add()` advances `_next_id` — ids are never reused.
- A new `TodoList` method that acts on one to-do mirrors `complete()`: a `todo_id: int` parameter, returns the `Todo`, raises `KeyError` for an unknown id — a divergence is a decision, not an implementation detail.
- Code, docstrings, test names and commit messages use the terms in `GLOSSARY.md` (**Remove**, not delete or discard) — one word per idea across specs and code.
- No runtime dependency is added to `pyproject.toml`: standard library only — the library is meant to stay trivial to install.

## Errors and configuration

- An exception raised by the standard library (such as `KeyError` from `dict`) propagates unchanged, with no wrapping and no custom message — callers catch the same exception from every method.
- The library neither logs nor prints — it has no I/O, and output belongs to the caller.

## Security

- No secret is read, stored, logged or committed other than as the architecture's Secrets table says — a leaked secret can't be taken back. Today the table lists none; a secret a later story needs lives in GitHub Actions secrets and reaches the code as an environment variable.

## Tests

- Tests verify behaviour through public interfaces, at the seams `specs/shape-check-7/test-strategy.md` names: they import only from `testbed` and never read a `_`-prefixed attribute or call a private method — tests that reach inside break on every refactor.
- Mock only at system boundaries; never the project's own modules. The library has no boundaries today, so a test that uses `unittest.mock`, `monkeypatch` or similar is a defect — mocks of our own code test the mock.
- An expected value comes from an independent source (a literal from the PRD or a worked example), never recomputed the way the code does — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- Each test builds its own `TodoList()` inline, with no fixtures, `conftest.py` or shared state — tests stay independent and readable on their own.
- A story doesn't edit an existing test unless its spec changes that behaviour; new tests go in `tests/test_<module>.py`, named `test_<method>_<behaviour>` — an edited test can hide a regression.

## Mechanical rules

Enforced by tools, not reviewers. The guardrails story sets them up; CI blocks a merge on each.

| Rule | Tool and setting | CI check |
|------|------------------|----------|
| Tests pass | pytest >= 8 (dev group, locked in `uv.lock`), `testpaths = ["tests"]` | `uv run pytest` |
| Dependencies match the lockfile | uv, `--locked` | `uv sync --locked` |
| Formatting | None at poc | n/a |
| Lint | None at poc | n/a |
| Types | None at poc | n/a |
| Secret scan | GitHub secret scanning with push protection (a repository setting, not a CI step; the guardrails story turns it on) | n/a: GitHub blocks the push |

No formatter, linter or type checker is added at poc: each would add a dev dependency and configuration to `pyproject.toml`, and the current initiative keeps it unchanged (NFR003). Adding them, ruff and a type checker being the obvious candidates, is a decision for the MVP stage.

The CI job: `test` in `.github/workflows/ci.yml`, triggered by every pull request and every push to `main`; branch protection on `main` requires it to pass.
