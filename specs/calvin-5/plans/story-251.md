# Every patched() id has its own replay test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the source guardrail from counting `runReplayHistory` calls to matching each `patched()` id to a replay test that names it, and add the replay tests (with recorded pre-patch histories) the three ids on main need.

**Architecture:** A pure checker `patchedIdProblems(workflowTexts, testSources)` in `tests/support/patched-ids.ts` returns one message per id that no replay test names. `tests/guardrails-source.test.ts` calls it on the real sources, and a new `tests/patched-ids.test.ts` calls it on synthetic sources (AC2, AC3). Replay tests in `tests/workflow/plan-workflow.test.ts` replay recorded histories from `tests/fixtures/workflow/`, one fixture per id, recorded from the workflow as it stood just before that patch. `src/` does not change.

**Tech Stack:** TypeScript (Node 26 type stripping), Vitest 5, `@temporalio/worker` `Worker.runReplayHistory`, `@temporalio/testing` time-skipping server.

**Spec:** .factory/story.md (story #251)

## Global Constraints

- Use Temporal's `patched()` / `deprecatePatch()` for any change to `planWorkflow` once plans are live, with a replay test against a recorded history; don't hand-roll version flags — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- Workflow code imports only `@temporalio/workflow` and types, gets its schedule as epoch milliseconds, and uses neither `Intl` nor JS `Temporal` — workflow code must replay deterministically. ([ADR 0001](docs/adr/0001-temporal-workflow-per-plan.md))
- No test is written at a seam this table doesn't name.
- `TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database.
- `fileParallelism: false` makes test files run one after another. The time-skipping server's clock is global, so workflow tests must run serially anyway (research/temporal-typescript-sdk.md). Each integration file resets the database before each test.
- Source patterns | `tests/guardrails-source.test.ts`: no `console.*` outside `src/log.ts`, `src/main.ts` and `src/db/migrate.ts`; no `Date.now()` or `new Date()` outside `src/main.ts` and `src/db/schema.ts`; no `luxon` or `date-fns-tz`; no `vi.mock` | `npx vitest run`

Binding: CODING_STANDARDS.md, specs/calvin-5/test-strategy.md, docs/adr/0001-temporal-workflow-per-plan.md

## Review Focus

- A replay test whose fixture is renamed or deleted: the guardrail must fail naming the id, not pass on a leftover count (Task 2's mutation check).
- A `patched()` id that is a substring of another id (`reminders-3-3` vs a future `reminders-3-3b`): matching is by id as a whole word, not a bare substring (Task 1).
- An id named only in a comment or a non-replay test: it must not count (Task 1).
- An id named by a test that does not call `runReplayHistory`: it must not count (Task 1).
- A `patched()` id that appears in more than one workflow file or twice in one: it is checked once (Task 1).

---

### Task 1: Pure by-id checker

**Covers:** AC2, AC3

**Files:**
- Create: `tests/support/patched-ids.ts`
- Create: `tests/patched-ids.test.ts`

**Interfaces:**
- Produces: `type Source = { file: string; text: string }` and `patchedIdProblems(workflows: Source[], tests: Source[]): string[]` exported from `tests/support/patched-ids.ts`. Returns `[]` when every distinct `patched('<id>')` id found in `workflows` is named by at least one replay test in `tests`; otherwise one message per unnamed id, each containing the id in single quotes, e.g. `patched('example-x') has no replay test naming it`.
- A **replay test** is a plain `it(` or `test(` call (not `it.each`) in a file under `tests/workflow/` whose block (from its `it(`/`test(` to the next one) contains `runReplayHistory(`. It **names** an id if the id, as a whole word (not preceded or followed by `[\w-]`), appears in the test's name (the first string literal after `it(`) or in any string literal passed to `loadHistory(` inside the block. Comments and other text in the block do not count.

- [ ] **Step 1: Write the failing test** `tests/patched-ids.test.ts`, with small helpers `workflow(...ids)` building a `Source` for `src/temporal/workflows.ts` with one `patched('<id>')` per id, and `replay(name, fixture?)` building a `tests/workflow/x.test.ts` source holding one `it('<name>', async () => { await Worker.runReplayHistory(..., loadHistory('<fixture>')) })`. First test (AC2): workflow with `example-x` and `confirmed-emails-3-2`, one replay test named `replays before confirmed-emails-3-2` → `patchedIdProblems(...)` equals `[expect.stringContaining('example-x')]`. Second (AC3): workflow with the three real ids; tests: two replay tests named `replays before reminders-3-3` and `replays again, reminders-3-3`, one named `replays before confirmed-emails-3-2` → exactly one problem, containing `call-off-3-5`.
- [ ] **Step 2: Run** `npx vitest run tests/patched-ids.test.ts`. Expected: FAIL, `patched-ids.ts` does not exist.
- [ ] **Step 3: Implement** `patchedIdProblems` in `tests/support/patched-ids.ts` to the Interfaces rules above (regex `/patched\('([^']+)'\)/g` on the workflow sources, dedupe through a `Set`; split test text on `/^[ \t]*(?:it|test)\(/m`). Run the two tests: PASS.
- [ ] **Step 4: One test at a time, add and watch fail then pass** (each guards a Review Focus line): a fixture-named match (`replay('replays an old history', 'before-call-off-3-5')` names `call-off-3-5`); an id only in a `//` comment inside a replay test is still a problem; a test naming the id but calling no `runReplayHistory` is still a problem; `reminders-3-3b` in a test name does not name `reminders-3-3`; the same id in two workflow sources yields one problem; a replay test outside `tests/workflow/` does not count. Each new test is run RED before the implementation change that makes it pass; those that pass at once are shown to fail by mutating the checker (e.g. drop the whole-word guard) and reverting.
- [ ] **Step 5: Run** `npx tsc --noEmit && npx vitest run tests/patched-ids.test.ts`. Expected: no type errors, PASS.
- [ ] **Step 6: Commit**

```bash
git add tests/support/patched-ids.ts tests/patched-ids.test.ts
git commit -m "Check patched() ids by name, not by count (checker)"
```

### Task 2: Wire the guardrail and add the three replay tests

**Covers:** AC1, AC4

**Files:**
- Modify: `tests/guardrails-source.test.ts` (the last test, lines 49-56)
- Modify: `tests/workflow/plan-workflow.test.ts` (`loadHistory` and `confirmed32Path` at lines 18-25; the replay tests at lines 508-522 and 646-662)
- Rename: `tests/fixtures/workflow/confirmed-3-2.json` → `tests/fixtures/workflow/before-reminders-3-3.json` (`git mv`; the content is already a history recorded by the 3.2-era workflow, before the reminders patch)
- Create: `tests/fixtures/workflow/before-confirmed-emails-3-2.json`, `tests/fixtures/workflow/before-call-off-3-5.json`

**Interfaces:**
- Consumes: `patchedIdProblems`, `Source` from Task 1.
- Produces: `loadHistory(name: string)` in `plan-workflow.test.ts`, reading `tests/fixtures/workflow/<name>.json` (replaces the path-taking `loadHistory` and the `confirmed32Path` const), so the fixture name appears as a string literal inside each replay test.

- [ ] **Step 1: Write the failing guardrail.** In `tests/guardrails-source.test.ts` replace the count assertion: keep the test name, compute `patches` input as `app.filter(({ file }) => file.endsWith('workflows.ts'))`, and assert `expect(patchedIdProblems(workflows, tests)).toEqual([])`; import `patchedIdProblems` from `./support/patched-ids.ts` (and its `Source` type in place of the local one, if identical).
- [ ] **Step 2: Run** `npx vitest run tests/guardrails-source.test.ts`. Expected: FAIL with three messages naming `confirmed-emails-3-2`, `reminders-3-3` and `call-off-3-5` (no current test name or fixture name contains them). Record this RED output in the commit message body.
- [ ] **Step 3: Record the two missing histories, from the workflow as it stood before each patch.** Introducing commits (from `git log -S"patched('<id>')" -- src/temporal/workflows.ts`): `confirmed-emails-3-2` is `2fc774d`, `reminders-3-3` is `becd4f8`, `call-off-3-5` is `c8c99e6`. The workflow source before a patch is `git show <sha>^:src/temporal/workflows.ts` (it imports only `@temporalio/workflow` and a type from `./activities.ts`, so it runs as a standalone file). Before `confirmed-emails-3-2` that is `2fc774d^`; before `call-off-3-5` it is `c8c99e6^`.
  - Write a throwaway `tests/workflow/record.tmp.test.ts` (never committed) that copies the old source to `tests/workflow/old-workflows.tmp.ts` (also never committed), runs a worker on it with `workflowsPath` pointing at it and `createActivities` from the current tree, reusing the test file's `confirmedPlan`/`runSchedule`/`EXAMPLE` scenario of "sends the confirmed email to everyone when the confirmed signal arrives" (three committers, confirmed signal at `2026-11-12T18:00:00Z`), then writes `proto.temporal.api.history.v1.History.toObject(await handle.fetchHistory(), { longs: String, enums: String, bytes: String })` as 2-space JSON, the same shape as the existing fixture.
  - If the old workflow calls an activity the current `createActivities` lacks, rule the smallest shim in the throwaway file and note it as a `Ruling:`.
  - Delete both temp files afterwards.
- [ ] **Step 4: Rewrite the replay tests**, one per id, each a plain `it(` calling `Worker.runReplayHistory({ workflowsPath }, loadHistory('<name>'))` and asserting `.resolves.toBeUndefined()`:
  - `it('replays a history recorded before confirmed-emails-3-2', …)` with `loadHistory('before-confirmed-emails-3-2')`, in the `planWorkflow confirmed phase` describe.
  - `it('replays a history recorded before reminders-3-3', …)` with `loadHistory('before-reminders-3-3')`: this replaces `'replays a history recorded before the reminders patch'`; keep its live `fetchHistory()` replay, drop the stale comment's old path.
  - `it('replays a history recorded before call-off-3-5', …)` with `loadHistory('before-call-off-3-5')`, in the `planWorkflow call-off` describe. Rename the existing `'replays a history recorded after this patch'` to `'replays a history recorded with the call-off applied'` (it names no id, so it can't stand in for one).
- [ ] **Step 5: Run** `npx vitest run tests/guardrails-source.test.ts tests/patched-ids.test.ts tests/workflow/plan-workflow.test.ts -t "replays|patched|guardrail"` then the whole suite `npx vitest run` and `npx tsc --noEmit`. Expected: all PASS; the three new replay tests pass without a nondeterminism error (AC4).
- [ ] **Step 6: Show the new tests can fail (mutations, reverted afterwards).** (a) Rename `before-call-off-3-5.json` → the guardrail fails naming `call-off-3-5`'s fixture load, and the replay test fails to open it. (b) In `src/temporal/workflows.ts` temporarily insert an extra `await activities.sendToCommitters(input.planId, 'confirmed')` before the first `patched(...)` call: the three pre-patch replays fail with a nondeterminism error. Restore with `git checkout src/temporal/workflows.ts`. Do not commit either mutation; `git status` shows only the intended files.
- [ ] **Step 7: Commit**

```bash
git add tests/guardrails-source.test.ts tests/workflow/plan-workflow.test.ts tests/fixtures/workflow
git commit -m "Each patched() id has its own replay test"
```

## Rulings

Ruling: Matching is by whole-word id in a test's name or in the string literal passed to `loadHistory(` — the story allows the test name or the fixture name, and fixtures are loaded by name through that helper — a test that loads its fixture some other way would not count until it uses `loadHistory`.
Ruling: A single test naming two ids satisfies both — the story requires "a test that names" each id, not one test per id, and forbidding it would need a rule the story doesn't state — if wrong, one test could cover two patches; the three tests here name one id each.
Ruling: The checker lives in `tests/support/patched-ids.ts` and is tested on synthetic sources in `tests/patched-ids.test.ts` — AC2 and AC3 need to run the guardrail against code that isn't on main, and test-strategy.md puts helpers in `tests/support/` — if wrong, the guardrail logic moves back inline and AC2/AC3 lose their direct tests.
Ruling: Only plain `it(`/`test(` calls count as replay tests, not `it.each` — splitting `it.each` blocks by regex is unreliable, and the three replay tests are plain — a future `it.each` replay test is reported as a missing replay test, which fails loudly rather than silently.
Ruling: The pre-patch fixtures are recorded from git history (`2fc774d^`, `2fc774d`'s existing fixture, `c8c99e6^`) through a throwaway test, not hand-written — a hand-built history would not prove the real old workflow's history replays — it costs one recording step, and if the old source can't run against current activities the builder rules a shim.
