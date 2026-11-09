# PRD: idea17-check

Maturity: **poc**. A throwaway initiative that checks the LF Factory's idea 17 on the testbed (lf-factory ADR 0028): story PRs take current main before they open or update, and a "Request changes" review reworks the same PR. The operator approved it on 2026-11-09.

## Goal

Two small wording changes to the same line of the repository's readme. The change itself doesn't matter. What matters is that both stories edit the same line, so whichever merges second has to take main and resolve a conflict.

## Scope

- FR001: the readme's description line says the testbed is home to calvin.
- FR002: the readme's description line says the testbed is never reset during a run.

Nothing else changes. There's no code, no new test, no data and no user interface. The app, its tests and CI are left alone, and they must still pass.

## Constraints

- Docs only. The only file that changes is the readme at the root of the repository.
- The test command (`npx vitest run`) and the type check (`npx tsc --noEmit`) must still pass. Neither is affected by a readme change.
- Security: no secrets, no new dependency and no external call.

## Out of scope

Everything else. Architecture, data, API, UX and the test strategy are calvin's, unchanged, and don't apply to a readme change.
