# lf-factory-testbed

A throwaway practice repo for [LF Factory](https://github.com/Leapfrogger-ai/lf-factory). The factory runs against it while it is being built (build steps 3–5 and 7), so its early mistakes land somewhere harmless. It is not the pilot.

The app is a tiny in-memory to-do list library (`src/testbed/`), just enough code for an agent to change.

- Run the tests: `uv run pytest`
- `main` is protected: one approving review (not the author's), and the `test` check must pass.

Expect issues, branches and PRs here to be wiped and reset between runs.
