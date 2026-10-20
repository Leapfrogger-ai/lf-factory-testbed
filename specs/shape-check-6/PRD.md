# Remove a to-do - Product Requirements Document

**Author**: Rodbot One
**Date**: 2026-10-20
**Maturity**: poc
**Version**: 1.0

---

## Goals

- A developer can **remove** a to-do by id. After that, the to-do is gone from the list: `pending()` doesn't return it, and `complete()` and `remove()` reject its id.
- `TodoList` gains exactly one public method. Every existing test still passes unchanged.
- The factory takes the change through as one small story, to a merged PR with the `test` check green in CI.

---

## Background Context

`TodoList` can `add()` and `complete()` to-dos, but it can't take back a mistaken `add()`. Right now the only way to get a to-do out of `pending()` is `complete()`, and that wrongly records the to-do as done. **Remove** fixes this by deleting the to-do outright and recording nothing about it (see `GLOSSARY.md`).

The library is the LF Factory testbed, so the real aim is a small, well-shaped story that exercises the factory end to end, not product reach. The design copies `complete()` on purpose, so that both methods behave the same: same signature, same return value, same `KeyError` for an unknown id.

---

## Functional Requirements

### Remove

| ID | Requirement | Priority |
|----|-------------|----------|
| FR001 | `TodoList.remove(todo_id: int) -> Todo` deletes the to-do with that id from the list and returns the removed `Todo`. | Must |
| FR002 | A removed to-do no longer appears in `pending()`. | Must |
| FR003 | `remove()` works on a to-do whether it is **pending** or already **complete**. | Must |
| FR004 | `remove()` raises `KeyError` for an id that isn't in the list. That includes an id that was never handed out and an id that has already been removed, so removing the same id twice raises `KeyError`. | Must |
| FR005 | After a to-do is removed, `complete()` on its id raises `KeyError`. | Must |
| FR006 | Ids are never reused. After a removal, `add()` keeps counting up from the next unused id. Example: add 1 and 2, remove 2, add → the new to-do gets id 3. | Must |

### Tests

| ID | Requirement | Priority |
|----|-------------|----------|
| FR007 | Each of FR001–FR006 has a test in `tests/test_todo.py`. | Must |
| FR008 | Tests check removal only through the existing API: absence from `pending()`, and `KeyError` from `complete()` and `remove()`. No new read accessor such as `get()` or `all()` is added. | Must |

---

## Non-Functional Requirements

| ID | Category | Requirement | Target |
|----|----------|-------------|--------|
| NFR001 | Compatibility | Existing behaviour and tests stay as they are. | All existing tests pass unmodified |
| NFR002 | API surface | The public API grows by this one method only. | `TodoList` gains `remove`, nothing else |
| NFR003 | Dependencies | Standard library only. | No new entries in `pyproject.toml`; Python >= 3.12 |
| NFR004 | CI | The change passes the existing CI. | `test` check green on the PR |

---

## User Journeys

### Journey 1: Take back a mistaken add

**Persona**: A developer using `TodoList` in their own code
**Goal**: Get rid of a to-do they added by mistake, without marking it done

| Step | Developer action | Library response |
|------|------------------|------------------|
| 1 | `todo = todos.add("wrong title")` | Returns a new `Todo` with the next id |
| 2 | `todos.remove(todo.id)` | Deletes it and returns the removed `Todo` |
| 3 | `todos.pending()` | The removed to-do is not in the result |

**Alternative paths**:
- The to-do was already complete → `remove()` still deletes it and returns it.

**Error handling**:
- The id is unknown or already removed → `KeyError`, as `complete()` does.

---

## Epic List

| Epic | Title | Goal | Est. Stories |
|------|-------|------|--------------|
| 1 | Remove a to-do | Add `TodoList.remove()` and its tests, covering FR001–FR008 | 1 |

**Delivers**: a developer can remove a to-do by id, through a merged PR with the `test` check green.

Stories are written in the `epics` stage.

---

## Out of Scope

### Deferred to future phases

- Undo or restore a removed to-do: not needed to take back a mistake in a PoC.
- Soft-delete or archive: deleting outright is enough for a PoC.

### Explicitly excluded

- Bulk removal or "clear done": scope creep. One id at a time is enough.
- Editing a title: a separate concern.
- Saving to disk: the library stays in-memory.
- New read accessors (`get()`, `all()`): they would break the one-method constraint (NFR002).

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-10-20 | Rodbot One | Initial PRD |

---

## References

- [Brief](./brief.md), including its *Settled in grilling* section
- [Glossary](../../GLOSSARY.md): **Remove**, **Complete**, **Pending**
