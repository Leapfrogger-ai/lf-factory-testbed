# Test Strategy: Remove a to-do

**Maturity**: poc

The library is in-memory Python with no I/O, network, database, UI or HTTP API (`database-schema.md`, `api-specification.md` and `ux-spec.md` are all Not applicable). So there is one layer, unit tests, at one seam, and nothing to isolate between worktrees beyond the virtualenv uv already creates per checkout.

## Seams

| Seam | Module or surface | Catches | Misses |
|------|-------------------|---------|--------|
| Package API | `TodoList` and `Todo` as imported with `from testbed import TodoList` (`src/testbed/__init__.py`): `add()`, `complete()`, `pending()`, `remove()` | Every behaviour in FR001–FR006: what `remove()` returns, absence from `pending()`, `KeyError` from `remove()` and `complete()`, the next id `add()` hands out | Nothing a caller can observe. It deliberately can't see `_items` or `_next_id`, which FR008 forbids tests from reading |

No test is written at a seam this table doesn't name. In particular, tests import from `testbed`, not `testbed.todo`, and never touch an attribute starting with `_`.

## Layers

| Layer | Seams | Tool | Runs in CI |
|-------|-------|------|------------|
| Unit | Package API | pytest (dev group, `>=8`, pinned in `uv.lock`) | yes |

No integration or end-to-end layer: there are no two modules to integrate and no running system. Tests live in `tests/test_todo.py`, named `test_<method>_<behaviour>` (e.g. `test_remove_unknown_id_raises`), using plain `assert` and `pytest.raises(KeyError)` as the existing tests do.

## Real vs mocked

| Dependency | Unit | Why |
|------------|------|-----|
| `TodoList`, `Todo` (the project's own code) | real | Never mock the project's own modules |
| Python `dict` (stdlib) | real | It is the implementation, not a boundary |
| Time, randomness, file system, network | not used | The library touches none of them, so nothing is mocked |

Nothing is mocked in this initiative. A test that introduces `unittest.mock`, `monkeypatch` or a fake is a review failure.

Rules for reviewers:
- **Mock only at system boundaries; never the project's own modules.** There are no boundaries here, so no mocks.
- **No implementation-coupled tests.** Observe removal only through the public API (FR008): absence from `pending()`, `KeyError` from `complete(id)` and `remove(id)`, the id the next `add()` returns. A test that reads `_items` or `_next_id`, or adds an accessor such as `get()` or `all()` to make testing easier, fails review.
- **No tautological tests.** Expected values are literals from the PRD, not computed from the code. The FR006 test is exactly: add 1 and 2, remove 2, add, and assert the new id is the literal `3`. FR001 asserts the returned `Todo`'s `id` and `title` against the values passed to `add()`, and FR003 asserts its `done` is `True` for a completed to-do.
- **Vertical slices (TDD per task).** One failing test, then the code that makes it pass, then the next. Not all tests first.
- **Existing tests are not edited** (NFR001). New tests are added after them in `tests/test_todo.py`.
- **Coverage of the FRs:** at least one test per FR001–FR006 (FR007), and FR004 covers both a never-issued id and removing the same id twice.

## Fixtures and seed data

None. Each test builds a fresh `TodoList()` and adds only the to-dos it uses, as the existing tests do. No `conftest.py`, pytest fixtures or shared state.

## Worktree isolation

| Resource | Taken from |
|----------|-----------|
| Ports | none used |
| Test database | none used |
| Virtualenv | `.venv/` inside the worktree, created by `uv sync` (gitignored) |

The library opens no ports and has no database, so `FACTORY_PORT_BASE`, `FACTORY_PORT_COUNT` and `FACTORY_DB_NAME` are not read, and parallel stories can't collide. Each worktree gets its own `.venv`; uv's shared package cache is safe to use concurrently. Nothing needs creating or dropping.

## Commands

| Command | Exact command |
|---------|---------------|
| test | `uv run pytest` |
| build | empty: nothing is built (CI doesn't build the package) |
| setup | `uv sync --locked` |

For the repo's `.factory.toml`:

```toml
[commands]
test = "uv run pytest"
build = ""
setup = "uv sync --locked"
```

## CI

| Check | Blocks a merge | Command |
|-------|----------------|---------|
| Tests | yes | `uv sync --locked && uv run pytest` |
| Lint | no (none configured) | none |
| Type check | no (none configured) | none |

The existing GitHub Actions `test` job in `.github/workflows/ci.yml` runs on every pull request and on pushes to `main`, unchanged (NFR004). It should finish in well under a minute; anything over 5 minutes means something is wrong.
