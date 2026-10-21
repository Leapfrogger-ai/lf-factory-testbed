# Coding standards

Judgment rules for reviewers. Each is one sentence a reviewer can answer yes or no to, then its reason. Rules a tool checks are under "Mechanical rules", not here. These standards start small and grow: a rule is added when a review or a retrospective shows it's needed.

**Maturity**: poc

## Platform

Use what the stack provides; each rule comes from a "Platform Capabilities" row in [specs/shape-check-6/architecture.md](specs/shape-check-6/architecture.md).

- Use Python `dict`'s `pop(key[, default])`, called without a default, to remove a to-do; don't hand-roll a membership check, a `raise KeyError`, a `del` and a separate lookup — [finding](specs/shape-check-6/research/python-dict-pop.md).
- Use Python `dict`'s preserved insertion order to keep `pending()` in the order to-dos were added; don't hand-roll re-sorting by id or a separate order list — [finding](specs/shape-check-6/research/python-dict-pop.md).

## Structure

- A `TodoList` method that acts on one to-do takes `todo_id`, returns the `Todo` and raises `KeyError` for an unknown id, as `complete()` does — callers learn one shape, and a divergence is a decision, not a detail.
- Code, docstrings, test names and commit messages use the [glossary](GLOSSARY.md)'s terms (**Remove**, **Complete**, **Pending**), not its _Avoid_ words — one name per idea across specs and code.
- The public API grows only by what the PRD names: no other public method, property or `testbed/__init__.py` export, least of all one added to make testing easier — every addition is an interface callers depend on.
- Only `add()` changes `_next_id` — a removed id is never handed out again.
- No runtime dependency is added to `pyproject.toml`; the library uses the standard library only — a dependency is a decision, not an implementation detail.

## Errors and configuration

- A `KeyError` raised by a `dict` lookup or `pop` propagates unchanged: no `try`/`except`, no wrapper exception, no custom message — callers already handle `KeyError` from `complete()`.
- The library adds no logging, configuration or environment variables — it has no I/O, and the architecture names none.

## Security

- No secret is read, stored, logged or committed other than as the architecture's Secrets table says (at present: none at all) — a leaked secret can't be taken back.

## Tests

- Tests verify behaviour through public interfaces, at the seams [specs/shape-check-6/test-strategy.md](specs/shape-check-6/test-strategy.md) names: they import from `testbed`, never `testbed.todo`, and touch no attribute starting with `_` — tests that reach inside break on every refactor.
- Mock only at system boundaries; never the project's own modules (here: no `unittest.mock`, `monkeypatch` or fakes at all) — mocks of our own code test the mock.
- An expected value comes from an independent source (a literal from the PRD), never recomputed the way the code does — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- Existing tests aren't edited; new tests are added after them in `tests/test_todo.py` — the old tests are the proof that existing behaviour is unchanged.
- Each test builds a fresh `TodoList()`, with no fixtures, `conftest.py` or shared state — a test reads top to bottom, and no test depends on another.

## Mechanical rules

Enforced by tools, not reviewers. At poc the only check is the existing test job: the brief keeps CI and `pyproject.toml` unchanged, so no formatter, linter or type checker is set up.

| Rule | Tool and setting | CI check |
|------|------------------|----------|
| Tests pass | pytest (dev group, `>=8`, pinned in `uv.lock`) | `uv sync --locked && uv run pytest` — blocks a merge |
| Secret scan | GitHub's secret scanning for public repositories (no workflow). **Unverified:** whether it is enabled on this repo hasn't been confirmed | GitHub, on push |

The CI job: `test` in `.github/workflows/ci.yml`, on every pull request and on pushes to `main`.
