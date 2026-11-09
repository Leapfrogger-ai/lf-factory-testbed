# A call-off is heard even when a signal fails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A confirmed plan's workflow learns from Postgres that the plan was called off even when no `calledOff` signal arrived, sends `not_this_time` once and ends; the call-off route tries the signal up to 3 times before logging.

**Architecture:** A new read-only activity `planState(planId)` returns the plan's stored state. In `planWorkflow`, the existing `endedByCallOff` check (run before the 24h reminder, before the morning reminder and before the check-in) asks it when no signal has set `isCalledOff`, behind a new `patched('call-off-from-db-4-4')` with its own replay test against a history recorded before the change. The route's signal call becomes a bounded loop of 3 immediate attempts, logging `plan signal failed` only after the third fails.

**Tech Stack:** TypeScript (Node 26 type stripping), Hono, Vitest 5, `@temporalio/workflow` (`patched`), `@temporalio/testing` time-skipping server, the worktree's Postgres.

**Spec:** .factory/story.md (story #254)

## Global Constraints

- Use Temporal's `patched()` / `deprecatePatch()` for any change to `planWorkflow` once plans are live, with a replay test against a recorded history; don't hand-roll version flags — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Temporal's durable timers (`sleep`, `condition(fn, timeout)`) for waiting until the commit deadline, reminders and check-in; don't hand-roll a cron job, a due-items table or `setTimeout` — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Temporal's signals (`defineSignal`, `setHandler`, `WorkflowHandle.signal`) to wake a plan's workflow on confirm, late commit and call-off; don't poll Postgres for state changes — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Every activity re-reads Postgres and acts only if the plan's state still matches (no reminder unless `confirmed`, no `not_this_time` unless `called_off`, nothing to withdrawn committers) — signals are hints, not state. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Every email is sent through `sendOnce`, with its payload built only from stored data — that's what makes each email go out exactly once and a retry identical. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md), [ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Workflow code imports only `@temporalio/workflow` and types, gets its schedule as epoch milliseconds, and uses neither `Intl` nor JS `Temporal` — workflow code must replay deterministically. ([ADR 0001](docs/adr/0001-temporal-workflow-per-plan.md))
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed in. ([test-strategy](specs/calvin/test-strategy.md))
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities. ([ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- `TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database.
- `fileParallelism: false` makes test files run one after another. The time-skipping server's clock is global, so workflow tests must run serially anyway (research/temporal-typescript-sdk.md). Each integration file resets the database before each test.

Binding: CODING_STANDARDS.md, specs/calvin-5/test-strategy.md, specs/calvin-5/architecture.md, docs/adr/0001-temporal-workflow-per-plan.md, docs/adr/0002-postgres-owns-state-temporal-owns-time.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md

## Review Focus

- A plan called off *after* the 24h reminder went out, signal lost: the morning reminder and check-in must not follow (Task 3, morning-reminder test).
- A committer who withdrew before the call-off, signal lost: gets no `not_this_time` (guaranteed by `sendToCommitters`, already pinned by `sends Not this time once each, and not to a committer who withdrew`; no new test).
- A signal that arrives *and* the plan is called off in Postgres: still exactly one `not_this_time` each, no second check (Task 3, AC5 test).
- A workflow started before this deploy replaying its recorded history (Task 1 fixture, Task 3 replay test).
- A call-off whose first signal attempt fails and later ones succeed: no `error` line and no extra signals after success (Task 4, AC3 test).

## Rulings

Ruling: The check-in email does not exist yet (Epic 4, a later story; the workflow's "check-in" step is only `waitUntil(checkInAt)` plus the call-off check). AC2 is proven by asserting Ana receives only her `confirmed` and one `not_this_time` email after the check-in time — it can't assert on a check-in template — if wrong, the check-in story must re-prove it with a real `check_in` send.
Ruling: The DB check reuses `endedByCallOff`, which already runs before the 24h reminder, before the morning reminder and after the wait for `checkInAt`; no new call sites — those are exactly the story's "before each reminder and before the check-in" — if wrong, a fourth call site is one line.
Ruling: The check is a new activity `planState` (a plain read) rather than `resolveDeadline`, which mutates open plans — a confirmed plan must never be changed by the check — if wrong, none: it reads only.
Ruling: The route retries immediately, with no delay between the 3 attempts — the story names no delay and a sleep in a request handler would hold the response; the Temporal client already waits on its own gRPC deadline per attempt — if wrong, a short outage can still exhaust all 3 attempts, and the workflow's DB check is the backstop.
Ruling: The route's loop is not a breach of "no hand-rolled retry loops": that rule covers Postgres and Resend calls inside activities; the route is not an activity and the story fixes "up to 3 attempts" — if wrong, there is no Temporal-native alternative for an HTTP handler.
Ruling: AC3's "the workflow receives it" is proven at the route (the third attempt reaches `planWorkflows.signal`, no error logged) plus the existing signal-arrives workflow tests (Task 3 AC5 test); no test wires the real route to a workflow — the route's only boundary is the `planWorkflows.signal` dep — if wrong, a wiring bug between `signal` and the workflow handler would show in `main.ts` only.

---

### Task 1: Record a pre-change history for the replay test

**Covers:** AC5

**Files:**
- Create: `tests/fixtures/workflow/before-call-off-from-db-4-4.json`
- Modify: `tests/workflow/plan-workflow.test.ts` (one replay test)

**Interfaces:**
- Produces: fixture name `before-call-off-from-db-4-4` (a history of the current `planWorkflow` running the example plan, confirmed, called off after the 24h reminder with the signal delivered, to its end), loaded with the existing `loadHistory(name)` helper. Task 3 relies on it replaying cleanly.

No workflow or activity code changes in this task; do it first, while `src/temporal/workflows.ts` is unchanged.

- [ ] **Step 1: Record the history.** Add a temporary `it` at the end of `describe('planWorkflow call-off', ...)` that copies the body of `replays a history recorded with the call-off applied` (it already runs `confirmedPlan()`, `callOff`, `h.signal(calledOff)`), keeps the handle, then writes `proto.temporal.api.history.v1.History.toObject(await handle.fetchHistory(), { longs: String, enums: String, bytes: String })` with `JSON.stringify(..., null, 2)` to `tests/fixtures/workflow/before-call-off-from-db-4-4.json` (`writeFileSync` from `node:fs`). Run `npx vitest run tests/workflow/plan-workflow.test.ts -t "<its name>"`. Expected: PASS and the file exists. Delete the temporary `it` and the `writeFileSync` import.
- [ ] **Step 2: Check the fixture:** `grep -c "not_this_time" tests/fixtures/workflow/before-call-off-from-db-4-4.json` is at least 1.
- [ ] **Step 3: Add the replay test** after `replays a history recorded with the call-off applied`: `it('replays a history recorded before call-off-from-db-4-4', ...)` asserting `Worker.runReplayHistory({ workflowsPath }, loadHistory('before-call-off-from-db-4-4'))` resolves to `undefined`. Run it: PASS now (by design; Task 3 shows it can fail).
- [ ] **Step 4: Commit** `tests/fixtures/workflow/before-call-off-from-db-4-4.json tests/workflow/plan-workflow.test.ts` — "Record a pre-4.4 history for the replay test".

### Task 2: An activity that reads the plan's stored state

**Covers:** AC1

**Files:**
- Modify: `src/temporal/activities.ts` (`createActivities`)
- Test: `src/temporal/activities.test.ts`

**Interfaces:**
- Consumes: `loadSendTargets(db, planId)` (`src/domain/plans.ts`), which returns `plan.state` and throws `No plan for that id` for an unknown plan.
- Produces: `activities.planState(planId: string): Promise<'open' | 'confirmed' | 'called_off'>` — the plan's state in Postgres right now; read-only. Task 3's workflow calls it through the existing `activities` proxy.

- [ ] **Step 1: Write the failing test** in `src/temporal/activities.test.ts`, a new `describe('planState')`: `reports the stored state, even when no signal was sent` — publish the example plan with `threeIn()` (as the file's other tests do; minimum 3, so it is `confirmed`), assert `await activities.planState(published.planId)` is `'confirmed'`; `await callOff(deps, published.manageToken)`; assert it is now `'called_off'`. A second test `rejects for an unknown plan id` using a random uuid and `rejects.toThrow('No plan for that id')`.
- [ ] **Step 2: Run** `npx vitest run src/temporal/activities.test.ts -t planState`. Expected: FAIL (`planState is not a function`).
- [ ] **Step 3: Implement** `async planState(planId: string)` in `createActivities`, returning `(await loadSendTargets(deps.db, planId)).plan.state`. Re-run: PASS.
- [ ] **Step 4: Commit** `src/temporal/activities.ts src/temporal/activities.test.ts` — "Add a planState activity".

### Task 3: The workflow learns of a call-off from the database

**Covers:** AC1, AC2, AC5

**Files:**
- Modify: `src/temporal/workflows.ts` (`endedByCallOff`, inside the `reminders-3-3` block)
- Test: `tests/workflow/plan-workflow.test.ts`

**Interfaces:**
- Consumes: `activities.planState(planId)` (Task 2); the fixture `before-call-off-from-db-4-4` and its replay test (Task 1); the helpers already in the file: `confirmedPlan()`, `runSchedule(deps, planId, { schedule, confirmAt, sendEmail?, act })` (returns the clock `shift`), `timedEmail(deps)` (`.send`, `.records` with `to`, `subject`, `text`, `at`), `startingWith(records, prefix)`, `waitForEmails`, `EXAMPLE`, `EVERYONE`, `PAST_CHECK_IN`, `NOT_THIS_TIME`, `NOT_THIS_TIME_TEXT` (all in `describe('planWorkflow call-off')`).
- Produces: `const fromDb = patched('call-off-from-db-4-4')` next to `stopOnCallOff`; `endedByCallOff(): Promise<boolean>` becomes: if `!stopOnCallOff` return `false`; if `!isCalledOff && fromDb`, set `isCalledOff = (await activities.planState(input.planId)) === 'called_off'`; if `!isCalledOff` return `false`; otherwise send `not_this_time` through `activities.sendToCommitters` and return `true`. Nothing else in the workflow changes: with the patch absent (old history) it behaves exactly as before.

Work these in order, one test then its code. The scenario for the first three tests: `confirmedPlan()` (Ann creator, Mia, Raj; minimum 3; confirmed at `2026-11-12T18:00:00Z`), the creator calls off with `callOff(deps, published.manageToken)` while the workflow waits (Thu 12 Nov), and **no `calledOff` signal is sent** — that is "every signal fails". The 24h reminder time is `2026-11-13T18:00:00Z`; the morning reminder `2026-11-14T16:00:00Z`.

- [ ] **Step 1: Write the failing AC1 test** in `describe('planWorkflow call-off')`: `sends Not this time once each at the 24h reminder time when no signal arrived, and no reminder (AC1)`. All three committers stay active (the story's "every active committer"). Assert `startingWith(mail.records, 'Not this time:').map((r) => r.to).sort()` equals `EVERYONE`, each with subject `NOT_THIS_TIME` and text `NOT_THIS_TIME_TEXT`, `startingWith(mail.records, 'Tomorrow:')` and `'Today:'` equal `[]`, and each `Not this time` record has `at >= Date.parse('2026-11-13T18:00:00Z') + shift` (sent when the reminder was due, not at call-off) and `< Date.parse('2026-11-14T16:00:00Z') + shift`. `act`: `await waitForEmails(deps, 3); await callOff(deps, published.manageToken); await env.sleep(PAST_CHECK_IN);` — the workflow must also have *ended* (`runSchedule` awaits `handle.result()`, so a hang fails the test).
- [ ] **Step 2: Run** `npx vitest run tests/workflow/plan-workflow.test.ts -t "(AC1)"` — the `-t` must pick this one test (name it uniquely). Expected: FAIL (`Tomorrow:` has 3 records, `Not this time:` none).
- [ ] **Step 3: Implement** `fromDb` and the new `endedByCallOff` in `src/temporal/workflows.ts` as specified under Interfaces. Re-run Step 2: PASS.
- [ ] **Step 4: Write the AC2 test:** `sends Ana no check-in email when no signal arrived (AC2)` — same scenario and `act`; assert `mail.records.filter((r) => r.to === 'ann@example.test').map((r) => r.subject)` equals `["It's on: Coffee at Blue Bottle, Sat 14 Nov 10:00 AM", NOT_THIS_TIME]` (nothing at or after the check-in time `2026-11-14T18:01:00Z`: the workflow is over and `sleep(PAST_CHECK_IN)` has run), and that every record's `at` is `< Date.parse('2026-11-14T18:01:00Z') + shift`. Run it: it passes at once because Step 3 already ends the workflow at 24h. Show it can fail with a mutation: make `endedByCallOff` return `false` after the `planState` check, see the test FAIL (the workflow carries on to the reminders), restore.
- [ ] **Step 5: Write the morning-reminder test:** `sends no morning reminder or check-in when a call-off after the 24h reminder never signalled` — same scenario, but `act` first sleeps to just after the 24h reminder (as `sends no morning reminder or check-in after a call-off between the two reminders` does: `env.sleep(Date.parse('2026-11-13T18:00:00Z') - Date.parse('2026-11-12T18:00:00Z') + 60_000)` then `vi.waitFor` three `Tomorrow:` records), then `callOff(...)` with no signal, then `env.sleep(PAST_CHECK_IN)`. Assert `Tomorrow:` to `EVERYONE`, `Today:` `[]`, `Not this time:` once each, with `at >= Date.parse('2026-11-14T16:00:00Z') + shift`. Run: PASS (code from Step 3); show it can fail by the same mutation, restore.
- [ ] **Step 6: Write the AC5 test:** `sends Not this time exactly once each when the signal arrived and the plan is called off in Postgres (AC5)` — `act`: `waitForEmails(deps, 3); await callOff(...); await h.signal(calledOff); await env.sleep(PAST_CHECK_IN);` Assert `startingWith(mail.records, 'Not this time:').map((r) => r.to).sort()` equals `EVERYONE` exactly (three records, so no recipient twice) and no `Tomorrow:`. Passes at once; show it can fail by temporarily making `endedByCallOff` send `not_this_time` twice when `fromDb` is set, see it FAIL on length, restore.
- [ ] **Step 7: Show the replay test can fail.** Temporarily remove the `fromDb &&` guard (call `planState` unconditionally) and run `-t "replays a history recorded before call-off-from-db-4-4"`: FAIL with a non-determinism error. Restore the guard; run it: PASS.
- [ ] **Step 8: Run** `npx tsc --noEmit && npx vitest run src/temporal tests`: all PASS (`tests/patched-ids.test.ts` includes the real-source check that every `patched('…')` id has a replay test naming it — the new id is named by the Task 1 test and fixture). Commit `src/temporal/workflows.ts tests/workflow/plan-workflow.test.ts` — "The workflow learns of a call-off from the database".

### Task 4: The call-off route tries the signal up to 3 times

**Covers:** AC3, AC4

**Files:**
- Modify: `src/web/routes/manage.ts` (the `called_off` branch of `POST /m/:token/call-off`)
- Test: `src/web/routes/manage.test.ts` (extend `describe('when the signal fails')`)

**Interfaces:**
- Consumes: `deps.planWorkflows.signal(planId, 'calledOff')`; `fakePlanWorkflows()` and `testDeps({ planWorkflows })` (`tests/support/builders.ts`, `fakes.ts`); `postCallOff(app, manageToken)`, `publishPlan`, `creator`, and the stdout-capturing pattern of the existing `still calls the plan off and logs an error` test.
- Produces: a local `signalCalledOff(deps, planId): Promise<boolean>` in `manage.ts`: up to 3 attempts, each `await deps.planWorkflows.signal(planId, 'calledOff')`, returning `true` at the first success and stopping, `false` if all 3 throw. The route logs `log.error('plan signal failed', { planId, signal: 'calledOff', errorName })` exactly once, with the last error's name, only when it returns `false`. Response, redirect and the DB change are unchanged.

- [ ] **Step 1: Write the failing AC3 test** (new `it` in `describe('when the signal fails')`, which already restores spies): `tries again and logs nothing when the signal fails twice and then succeeds (AC3)`. Build `deps` with `planWorkflows: { ...fakePlanWorkflows(), signal }` where `signal` is a counter-wrapped function that throws `new Error('temporal down')` on calls 1 and 2 and on call 3 pushes `{ planId, signal: name }` to a local `received` array. Capture stdout lines as the existing test does. After `postCallOff`: status `303`, `location` `/m/${manageToken}`, `received` equals `[{ planId: plan.id, signal: 'calledOff' }]` with the counter at exactly `3`, and `lines.filter((l) => l.level === 'error')` is `[]`.
- [ ] **Step 2: Run** `npx vitest run src/web/routes/manage.test.ts -t "(AC3)"`. Expected: FAIL (`received` empty, one error line).
- [ ] **Step 3: Implement `signalCalledOff`** and use it in the route; log inside the route on `false` with the same fields as today. For `errorName`, keep the last caught error (`error instanceof Error ? error.name : 'unknown'`). Re-run Step 2: PASS.
- [ ] **Step 4: Write the AC4 test:** `makes three attempts, then logs one error naming the plan and calledOff (AC4)` — `signal` always throws and counts; assert counter `3`, status `303`, `location` `/m/${manageToken}`, `(await loadPlan(deps.db, manageToken))!.state === 'called_off'`, `lines.filter((l) => l.level === 'error' && l.msg === 'plan signal failed')` has length `1` and `toMatchObject({ planId: plan.id, signal: 'calledOff' })`, and `JSON.stringify(lines)` contains neither `manageToken` nor `temporal down`. RED first: before Step 3 the old code makes 1 attempt, so this test's counter assertion would fail; since Step 3 is already done, show RED by mutating the loop bound to 2 attempts, see the counter assertion FAIL, restore.
- [ ] **Step 5: Update the older test** `still calls the plan off and logs an error (AC5)` only if it breaks (its `signal` throws every time, so it should still pass; do not edit it otherwise). Also confirm `a successful signal makes one attempt`: the existing test asserting `signalCalls` equals one entry (`manage.test.ts:244`) still passes, which proves success stops the loop.
- [ ] **Step 6: Run** `npx tsc --noEmit && npx vitest run`: all PASS. Commit `src/web/routes/manage.ts src/web/routes/manage.test.ts` — "Try the call-off signal up to 3 times".
