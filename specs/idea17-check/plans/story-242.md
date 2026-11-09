# Readme names the app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The readme's description line ends with ` Home of calvin, the small-gatherings app.`

**Architecture:** One text edit to `README.md`, driven by a small Vitest test that reads the readme. Nothing else changes.

**Tech Stack:** Markdown, Vitest 5 (`tests/*.test.ts`, `node:fs`).

**Spec:** .factory/story.md (story #242)

## Global Constraints

- Tests verify behaviour through public interfaces, at the seams `specs/calvin/test-strategy.md` names — tests that reach inside break on every refactor.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- No secret is read, stored, logged or committed other than as the architecture's Secrets table says (env vars from Fly secrets or a gitignored `.env`; never in `fly.toml`, the Dockerfile, the repo, a log line or a CI command line; `.env.example` holds names only) — a leaked secret can't be taken back.
- Source patterns: `tests/guardrails-source.test.ts`: no `console.*` outside `src/log.ts`, `src/main.ts` and `src/db/migrate.ts`; no `Date.now()` or `new Date()` outside `src/main.ts` and `src/db/schema.ts`; no `luxon` or `date-fns-tz`; no `vi.mock`
- The existing test command `npx vitest run` and type check `npx tsc --noEmit` must still pass
- Test ports and database come from `FACTORY_PORT_BASE` and `FACTORY_DB_NAME` in `vitest.config.ts`; run tests as-is, never hardcode a port or database name.

Binding: CODING_STANDARDS.md, GLOSSARY.md, specs/idea17-check/test-strategy.md, specs/idea17-check/epics.md

## Review Focus

- Sibling story (2) edits the same line concurrently (`Reset before each run.` → `…never during one.`): the test asserts only the line's ending and start, never the whole line, so either merge order stays green.
- Trailing newline: the readme keeps its final newline and adds no extra line; the three-line-shape test pins this.
- Double space: exactly one space before `Home of calvin…`; the test asserts the suffix with a single `. ` before it.

## Rulings

Ruling: Add `tests/readme.test.ts` although epics.md says no story adds a test — poc requires TDD for every task, and a readme check is cheap — if wrong, one extra small test file to delete.
Ruling: The test matches the description line by `endsWith`, not equality — story 2 rewrites the line's middle in parallel — if wrong, merging the two stories could break an exact-match test.
Ruling: AC2 ("only that line changed") is proved by a three-line-shape test plus a `git diff main` check in the verification step — a test can't see main's history — if wrong, a stray edit elsewhere would pass the test but fail the diff check.

---

### Task 1: Readme description names the app

**Covers:** AC1, AC2

**Files:**
- Create: `tests/readme.test.ts`
- Modify: `README.md` (line 3, the description line)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the failing tests** in `tests/readme.test.ts`, in the style of `tests/project.test.ts` (`readFileSync('README.md', 'utf8')`, `test` from vitest). Split the text on `\n`:
  - `test('readme description line ends with the app sentence')`: `lines[2]` ends with `'. Home of calvin, the small-gatherings app.'`, and starts with `"The factory's testbed."`.
  - `test('readme keeps its title and three-line shape')`: `lines[0]` is `'# lf-factory-testbed'`, `lines[1]` is `''`, and `text.replace(/\n$/, '').split('\n').length` is `3`.

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run tests/readme.test.ts`
Expected: the first test FAILS (the line currently ends `Reset before each run.`). The second passes on first run: show it can fail by temporarily adding a blank line to `README.md`, see it FAIL, then revert.

- [ ] **Step 3: Edit `README.md`:** append ` Home of calvin, the small-gatherings app.` (one leading space) to line 3, so it reads `The factory's testbed. Reset before each run. Home of calvin, the small-gatherings app.` Keep the final newline; touch no other line.

- [ ] **Step 4: Run to verify GREEN**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all tests PASS, tsc exits 0.

- [ ] **Step 5: Verify AC2 against main**

Run: `git diff main -- README.md`
Expected: exactly one `-` line and one `+` line, both the description line; the title line is not in the diff.

- [ ] **Step 6: Commit**

```bash
git add README.md tests/readme.test.ts
git commit -m "Readme names the app"
```
