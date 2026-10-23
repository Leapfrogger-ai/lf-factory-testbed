# Test Strategy: Remove a to-do

**Maturity**: poc

The library is in-memory Python with no I/O, network, database, UI or HTTP API (`database-schema.md`, `api-specification.md` and `ux-spec.md` are all `Not applicable`). So there is one seam, one layer, nothing to mock and nothing for worktrees to collide on. TDD per task: each task writes one failing test at the seam, then the code that makes it pass.

## Seams

| Seam | Module or surface | Catches | Misses |
|------|-------------------|---------|--------|
| `TodoList` public API | `from testbed import Todo, TodoList`: `add()`, `complete()`, `pending()`, `remove()`, and the fields of the `Todo` they return | Everything FR001–FR006 specify: the returned `Todo`, absence from `pending()`, `KeyError` from `complete()` and `remove()`, the next id `add()` hands out | Nothing that matters for this library; it has no other surface |

No test is written at a seam this table doesn't name. In particular, no test reads `TodoList._items` or `_next_id`, or imports from `testbed.todo` directly (FR008).

## Layers

| Layer | Seams | Tool | Runs in CI |
|-------|-------|------|------------|
| Unit | `TodoList` public API | pytest (>= 8, locked in `uv.lock`), plain `assert` and `pytest.raises` | yes |

No integration or end-to-end layer: there are no two real modules or external systems to join, and a PoC doesn't require them.

## Real vs mocked

| Dependency | Unit | Why |
|------------|------|-----|
| `Todo`, `TodoList` (the project's own code) | real | Never mock the project's own modules |
| Python standard library (`dict`, `dataclasses`) | real | Not a system boundary |
| Time, randomness, file system, network | not used | The library touches none of them; if a later story adds one, it is mocked here and this table gains a row |

Nothing is mocked. `unittest.mock`, `monkeypatch` and similar are not used.

Rules for reviewers:
- Mock only at system boundaries; never the project's own modules. This library has no boundaries, so a mock in a test is a defect.
- No implementation-coupled tests: test through the public API, never a side channel. A test that reads `_items` or `_next_id`, or calls a private method, fails review.
- No tautological tests: expected values come from an independent source, a literal from the PRD or a worked example (e.g. FR006's "add 1 and 2, remove 2, add → id 3" asserts the literal `3`, not `previous_id + 1`).
- Vertical slices: one test, then its implementation. Not all of FR001–FR006's tests first and then `remove()`.
- Existing tests in `tests/test_todo.py` are not edited (NFR001). New tests are appended to that file and named `test_<method>_<behaviour>` (e.g. `test_remove_unknown_id_raises`).

## Fixtures and seed data

None. Each test builds a fresh `TodoList()` inline and adds only the to-dos it needs, as the existing tests do. No `conftest.py`, no pytest fixtures, no shared or module-level state.

## Worktree isolation

| Resource | Taken from |
|----------|-----------|
| Ports | none used |
| Test database | none used |
| Virtual environment | `.venv/` inside each worktree, created by `uv sync` (per-worktree by construction) |

The tests open no ports and use no database, so `FACTORY_PORT_BASE`, `FACTORY_PORT_COUNT` and `FACTORY_DB_NAME` are ignored, and nothing creates or drops a database. Parallel worktrees share only uv's global package cache, which uv makes safe for concurrent use.

## Commands

| Command | Exact command |
|---------|---------------|
| test | `uv run pytest` |
| build | (empty: nothing builds; CI runs no build step) |
| setup | `uv sync --locked` |

The same three, written to `.factory.toml` at the repo root (the factory reads them from there):

```toml
[commands]
test = "uv run pytest"
build = ""
setup = "uv sync --locked"
```

## CI

| Check | Blocks a merge | Command |
|-------|----------------|---------|
| Tests | yes | `uv sync --locked` then `uv run pytest` |
| Lint | no (none configured) | n/a |
| Type check | no (none configured) | n/a |

The existing GitHub Actions job `test` in `.github/workflows/ci.yml` runs on every pull request and on pushes to `main`; branch protection on `main` requires it to pass (NFR004). It is unchanged by this initiative and should finish in under 2 minutes; the tests themselves take well under a second.
