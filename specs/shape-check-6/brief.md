# Product Requirements Brief: Remove a to-do

**Maturity**: poc
**Version**: 1.0
**Date**: 2026-10-20
**Author**: Rodbot One
**Status**: Approved

---

## Executive Summary

Add `TodoList.remove(todo_id)` to the testbed's to-do library so that a developer can delete a to-do added by mistake. The change is kept deliberately small, because its real purpose is to exercise LF Factory end to end.

---

## 1. Problem Statement

**Who**: A developer calling the `testbed` library from their own code.
**What**: A to-do added by mistake can't be taken back. It stays in `pending()` forever.
**Impact**: The only workaround is `complete()`, which wrongly records the to-do as done when it wasn't.
**Current workaround**: Call `complete(todo_id)` on the mistaken to-do.

---

## 2. Target Users

**Primary**: A developer using `TodoList` in their own code, who needs to undo a mistaken `add()`.

**Context**: This is the factory's testbed. The underlying goal is a small, well-shaped story for the factory to build, not product reach.

---

## 3. Goals

- A developer can **remove** a to-do by id, and it no longer appears anywhere in the list.
- The factory delivers this as one small story whose tests pass the `test` check in CI.

---

## 4. Scope

### 4.1 Must Have

| Feature | Acceptance Criteria |
|---------|---------------------|
| `TodoList.remove(todo_id)` | Deletes the to-do and returns the removed `Todo`, matching `complete()`. |
| Unknown id | `remove()` on an id that isn't in the list raises `KeyError`, matching `complete()`. |
| Done to-dos | A to-do that is already done can be removed too, not only pending ones. |
| No id reuse | After a removal, `add()` keeps counting up from `_next_id`. A removed id is never handed out again. |
| Tests | Each criterion above has a test in `tests/test_todo.py`. |

### 4.2 Won't Have

| Feature | Rationale |
|---------|-----------|
| Undo or restore | Not needed to take back a mistake in a PoC. |
| Bulk removal or "clear done" | Scope creep. One id at a time is enough. |
| Soft-delete or archive | Deleting outright is enough for a PoC. |
| Editing a title | A separate concern. |
| Saving to disk | The library stays in-memory. |

### 4.3 Success Criteria

- [ ] `remove()` behaves as in 4.1, and its tests pass.
- [ ] The existing tests and behaviour are unchanged.
- [ ] The factory takes the story through to a merged PR with the `test` check green.

---

## 5. Constraints

| Constraint | Description |
|------------|-------------|
| Technical | Standard library only, no new dependencies. Python >= 3.12. |
| API | The public API grows by this one method. Existing behaviour and tests stay as they are. |

---

## 6. Assumptions

| Assumption | Confidence | Risk if Wrong |
|------------|------------|---------------|
| Deleting outright, with no soft-delete, is good enough for a PoC. | High | A later story adds restore or archive. |

---

## 7. Open Questions

None.
