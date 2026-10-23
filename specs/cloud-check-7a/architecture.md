# Architecture: Remove a to-do

**Date**: 2026-10-20
**Version**: 1.0
**Maturity**: poc

---

## Executive Summary

This is a brownfield change to the `testbed` library: `TodoList` gains one method, `remove(todo_id)`, built in the same style as `complete()` in `src/testbed/todo.py`. It deletes the entry from the existing `_items` dict with `dict.pop`, leaves the `_next_id` counter alone so ids are never reused, and is covered by new tests in `tests/test_todo.py`. There is no new technology, dependency, module or infrastructure.

---

## Project Context

**Project**: Remove a to-do (cloud-check-7a)
**Scale**: 1 epic, 1 story
**Key characteristics**:
- An in-memory Python library with no UI, no I/O, no network and no persistence.
- The NFRs are all about restraint: existing tests stay unchanged (NFR001), the public API gains `remove` and nothing else (NFR002), standard library only (NFR003), and the existing `test` check stays green (NFR004).
- The design deliberately mirrors `complete()`: same signature shape, it returns the `Todo`, and it raises `KeyError` for an unknown id.

---

## Project Initialization

Not applicable: brownfield. The repo, its layout, `pyproject.toml`, `uv.lock` and CI already exist and stay as they are.

---

## Decision Summary

| Category | Decision | Version | Rationale | Affects Epics |
|----------|----------|---------|-----------|---------------|
| Language | Python (existing) | >= 3.12 (`requires-python`) | Already the project's language; NFR003 | 1 |
| Storage | The existing `TodoList._items: dict[int, Todo]` | stdlib | Removal is a delete from this dict; nothing new to store | 1 |
| Removal mechanism | `self._items.pop(todo_id)`, with no default | stdlib | Removes, returns and raises `KeyError` in one native call (see Platform Capabilities) | 1 |
| Id allocation | The existing `_next_id` counter, left untouched by `remove()` | n/a | Ids are never reused (FR006) | 1 |
| Testing | pytest (existing dev dependency) | >= 8 (`pyproject.toml`; exact version pinned in `uv.lock`) | Already the project's test runner | 1 |
| Package/env tool | uv (existing) | as used by `astral-sh/setup-uv@v6` in CI | Already used: `uv sync --locked`, `uv run pytest` | 1 |
| CI | GitHub Actions `test` job (existing) | `.github/workflows/ci.yml` | No change; NFR004 | 1 |
| Deployment | None | n/a | A library with no deployment target | n/a |

No new versions are introduced, so there is nothing to verify beyond what `pyproject.toml` and `uv.lock` already pin.

---

## Project Structure

Only the files this initiative touches are marked.

```
lf-factory-testbed/
├── src/testbed/
│   ├── __init__.py        # unchanged: exports Todo, TodoList (remove is a method, so no new export)
│   └── todo.py            # CHANGED: add TodoList.remove()
├── tests/
│   └── test_todo.py       # CHANGED: add remove() tests (FR007, FR008)
├── .github/workflows/ci.yml   # unchanged
├── pyproject.toml         # unchanged (NFR003)
└── uv.lock                # unchanged
```

---

## Epic to Architecture Mapping

| Epic | Primary Components | Key Technologies | Integration Points |
|------|-------------------|------------------|-------------------|
| Epic 1: Remove a to-do | `TodoList.remove` in `src/testbed/todo.py`; tests in `tests/test_todo.py` | Python stdlib `dict`, pytest | None. It reads and writes only `TodoList._items` |

---

## Technology Stack Details

### Python (standard library)
- **Version**: >= 3.12, as declared in `pyproject.toml`.
- **Purpose**: the library itself. `dict` holds the to-dos, keyed by id.
- **Resources**: [Mapping types: dict](https://docs.python.org/3.12/library/stdtypes.html#mapping-types-dict)

### pytest
- **Version**: >= 8 (dev group), locked in `uv.lock`.
- **Purpose**: unit tests, using plain `assert` and `pytest.raises(KeyError)` as the existing tests do.

### Integration Points

None.

---

## Platform Capabilities

The native features the build must use, so that no story hand-rolls them. Each row links a research finding that cites the platform's own documentation.

| Technology | Native feature | Use it for | Instead of hand-rolling | Finding |
|------------|----------------|------------|-------------------------|---------|
| Python 3.12 `dict` | `pop(key[, default])`, called **without** a default | Removing a to-do: it deletes the entry, returns the `Todo`, and raises `KeyError` for an unknown or already-removed id (FR001, FR004) | An `if todo_id not in self._items: raise KeyError(...)` check, followed by `del` and a separate lookup to return the value | [research/python-dict-pop.md](research/python-dict-pop.md) |
| Python 3.12 `dict` | Insertion order is preserved | `pending()` keeps returning the remaining to-dos in the order they were added after a removal, with no change to `pending()` | Re-sorting by id, or keeping a separate order list | [research/python-dict-pop.md](research/python-dict-pop.md) |

Not used, and why: none.

---

## Implementation Patterns

### The `remove()` method

It goes in `TodoList`, directly after `complete()`, and copies `complete()`'s shape:

```python
def remove(self, todo_id: int) -> Todo:
    return self._items.pop(todo_id)
```

Agents implementing this MUST:
1. Call `pop` **without** a default argument. A default would swallow the `KeyError` that FR004 and FR005 require.
2. Not touch `_next_id`. `add()` alone advances it, which keeps ids unique across removals (FR006).
3. Not check whether the to-do is done. Removal works on pending and complete to-dos alike (FR003).
4. Not add any other public method, property or export (NFR002, FR008). `__init__.py` stays as it is.
5. Let the `KeyError` raised by `dict` propagate unchanged, as `complete()` does through `self._items[todo_id]`. Don't wrap it and don't add a custom message.

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Methods | snake_case verb, using the glossary term | `remove` (not `delete`, `discard`: see `GLOSSARY.md`) |
| Parameters | snake_case, matching `complete()` | `todo_id` |
| Test files | `tests/test_<module>.py` (existing) | `tests/test_todo.py` |
| Test functions | `test_<method>_<behaviour>` (existing style) | `test_remove_unknown_id_raises`, `test_remove_does_not_reuse_ids` |

### Error Handling

- Unknown or already-removed id: `KeyError`, raised by `dict.pop` and propagated to the caller. This is the library's only error for this method.
- Nothing is logged: the library has no logging, and this change adds none.

### Testing Pattern

- Each test builds a fresh `TodoList()`. No fixtures or shared state, matching the existing tests.
- Tests observe removal only through the public API (FR008): absence from `pending()`, and `pytest.raises(KeyError)` from `complete(id)` and `remove(id)`. Tests don't read `_items` or `_next_id`.
- At least one test per FR001–FR006 (FR007). The FR006 test is exactly: add 1 and 2, remove 2, add, and assert the new id is 3.
- Existing tests are not edited (NFR001).

---

## Consistency Rules

- **Mirror `complete()`.** Same parameter name, same return type (`Todo`), same exception (`KeyError`). If the two ever need to diverge, that is a new decision, not an implementation detail.
- **Glossary terms.** Use **Remove**, **Complete** and **Pending** as `GLOSSARY.md` defines them, in code, docstrings, test names and commit messages.
- **Date/time, API response format, validation layers:** not applicable. The library has no timestamps and no API boundary.

---

## Data Architecture

The data model doesn't change:

```
TodoList
├── _items: dict[int, Todo]   # id -> Todo; remove() deletes the entry
└── _next_id: int             # next id to hand out; only add() changes it

Todo (dataclass)
├── id: int
├── title: str
└── done: bool = False
```

**State of a to-do:** *pending* → `complete()` → *complete*. Either state → `remove()` → gone (no entry in `_items`; its id is never handed out again).

---

## API Contracts

The public Python API gains one method:

| Method | Signature | Returns | Raises |
|--------|-----------|---------|--------|
| `TodoList.remove` | `remove(self, todo_id: int) -> Todo` | The removed `Todo`, as it was at the moment of removal | `KeyError` if `todo_id` isn't in the list (never handed out, or already removed) |

No other API changes. There is no HTTP API.

---

## Security Architecture

### Secrets (PoC)

| Secret | Where it lives | How it reaches the code |
|--------|----------------|-------------------------|
| None | n/a | n/a |

This change uses no secrets. The library makes no network calls and reads no credentials, and the CI `test` job (`uv sync --locked`, `uv run pytest`) uses no repository or environment secrets. If a later story needs one, it lives in GitHub Actions secrets and reaches the code as an environment variable, never in the repo, a log or a command line.

---

## Development Environment

### Prerequisites

- Python >= 3.12
- uv

### Setup Commands

```bash
uv sync
uv run pytest
```

### Environment Variables

None.

---

## Architecture Decision Records

None. No decision in this initiative is hard to reverse (as the brief records), and no native feature is deliberately left unused.

---

*Architecture document generated for Remove a to-do (cloud-check-7a)*
*Date: 2026-10-20*
