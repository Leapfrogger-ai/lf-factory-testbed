# Epics: Remove a to-do

## Epic 1: Remove a to-do

A developer can take back a mistaken `add()` by removing the to-do by id (PRD FR001–FR008), delivered as one story through a merged PR with the `test` check green.

Brownfield: no starter-code story. The project (Python >= 3.12, uv), the test command `uv run pytest`, which runs and passes, and the CI job `test` in `.github/workflows/ci.yml`, which runs `uv sync --locked` then `uv run pytest` on every pull request and on pushes to `main`, already exist, and `TodoList` already imports. The guardrails story covers only the rule with no check yet: the mechanical rules "Tests pass" and "Dependencies match the lockfile" are already enforced by that `test` job, which branch protection on `main` requires; formatting, lint and types have no tool at poc (`CODING_STANDARDS.md`); secret scanning with push protection is a repository setting that isn't confirmed on.

### Story 1.1 (v1): Remove a to-do by id

As a developer using `TodoList`, I want to remove a to-do by its id, so that I can take back a mistaken `add()` without recording the to-do as done. `remove(todo_id: int) -> Todo` behaves like `complete()`: same signature, same return of the `Todo`, same `KeyError` for an id that isn't in the list (see **Remove** and **Complete** in `GLOSSARY.md`). It is the only new public method, and the tests check it through the existing API only: `pending()`, `complete()` and `remove()`.

Prerequisites: None

Acceptance criteria:
- Given a list with a pending to-do, when I call `remove()` with its id, then the removed `Todo` is returned with that id and title.
- Given a list with a pending to-do, when I remove it, then `pending()` no longer returns it.
- Given a to-do that has been completed, when I call `remove()` with its id, then it is removed and returned.
- Given an id that was never handed out, when I call `remove()` with it, then `KeyError` is raised.
- Given a to-do that has already been removed, when I call `remove()` with its id again, then `KeyError` is raised.
- Given a to-do that has been removed, when I call `complete()` with its id, then `KeyError` is raised.
- Given to-dos 1 and 2 were added and 2 was removed, when I add another to-do, then it gets id 3.
- Given the existing test suite, when I run `uv run pytest`, then every existing test passes unmodified and each of the behaviours above has its own test.
- Given the change, when I compare the public API of `TodoList` before and after, then `remove` is the only addition and `pyproject.toml` has no new dependency.

### Story 1.2 (v1): Secret scanning blocks a pushed secret

As the team, we want GitHub secret scanning with push protection turned on for the repository, so that a token committed by mistake is blocked before it lands, the one mechanical rule in `CODING_STANDARDS.md` with no check yet.

Prerequisites: Story 1.1

Acceptance criteria:
- Given the repository settings, when I read its security and analysis settings through the GitHub API, then secret scanning and push protection are both enabled.
- Given a commit containing a credential in a format GitHub recognises, when it is pushed, then GitHub blocks the push.
