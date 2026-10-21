# Epics: Remove a to-do

## Epic 1: Remove a to-do

`TodoList` gains one public method, `remove()`, that takes back a mistaken `add()`, with tests covering FR001–FR008. This is a brownfield change: the project, its test runner (`uv run pytest`) and the CI `test` job already exist and stay as they are, so there is no starter-code story. The only mechanical rule is that the existing `test` check passes, which CI already enforces, so there is no guardrails story either.

### Story 1.1 (v1): Remove a to-do by id

As a developer using `TodoList` in my own code, I want to **remove** a to-do by its id, so that I can take back a mistaken `add()` without wrongly recording it as **complete**.

`remove(todo_id: int) -> Todo` mirrors `complete()`: same parameter name, it returns the `Todo`, and it raises `KeyError` for an id that isn't in the list. It removes with `dict.pop` called without a default and lets the `KeyError` propagate unchanged. It never changes the id counter, so a removed id is never handed out again. `TodoList` gains no other public method, property or package export, and no dependency is added.

Tests use the package API seam from the test strategy: they import from `testbed`, build a fresh `TodoList()` each, touch no attribute starting with `_`, use no mocks, and observe removal only through `pending()`, `complete()`, `remove()` and the id the next `add()` returns. Expected values are literals from the PRD. The existing tests are not edited; the new ones go after them, one test then its code.

Prerequisites: None

Acceptance criteria:
- Given a list where `add("wrong title")` returned a to-do with id 1, when I call `remove(1)`, then it returns a `Todo` whose `id` is 1 and whose `title` is "wrong title".
- Given a list with pending to-dos "a" and "b" added in that order, when I remove "a", then `pending()` returns only "b".
- Given a list with pending to-dos "a", "b" and "c" added in that order, when I remove "b", then `pending()` returns "a" then "c", in that order.
- Given a to-do that has been completed, when I call `remove()` on its id, then it returns that `Todo` with `done` equal to `True`.
- Given an empty list, when I call `remove(1)`, then it raises `KeyError`.
- Given a to-do that has already been removed, when I call `remove()` on its id again, then it raises `KeyError`.
- Given a to-do that has been removed, when I call `complete()` on its id, then it raises `KeyError`.
- Given a list where I added two to-dos (ids 1 and 2) and removed id 2, when I call `add()` again, then the new to-do's id is 3.
- Given the change, when I run `uv run pytest`, then every existing test passes unmodified alongside the new ones.
- Given a pull request with the change, when the CI `test` job runs `uv sync --locked && uv run pytest`, then the check is green.
