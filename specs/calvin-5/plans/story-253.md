# Reminders that arrive in time and in order — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reminder send that is still retrying when the gathering starts is dropped, and a reminder reaches a committer only after their `confirmed` email went out.

**Architecture:** Order is enforced in the activity: `sendToCommitters` for a reminder kind first sends the committer their `confirmed` email through `sendOnce` (a no-op if already sent), then the reminder. The drop is enforced in `planWorkflow`: the reminder activity call runs inside `CancellationScope.withTimeout(gatheringAt - now)`, and a cancelled reminder is treated as "not sent". The workflow needs the gathering's start, so `Schedule` and `PlanWorkflowInput` gain `gatheringAt`. The workflow change sits behind a new `patched('reminders-in-time-4-3')` with its own replay test against a history recorded before the change.

**Tech Stack:** TypeScript (Node 26 type stripping), Vitest 5, `@temporalio/workflow` (`CancellationScope`, `isCancellation`, `patched`), `@temporalio/testing` time-skipping server, the worktree's Postgres.

**Spec:** .factory/story.md (story #253)

## Global Constraints

- Use Temporal's activity retry policy and timeouts (`proxyActivities`, `retry`, `startToCloseTimeout`, `scheduleToCloseTimeout`) for retrying Postgres and Resend calls; don't hand-roll retry loops or backoff — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Temporal's `patched()` / `deprecatePatch()` for any change to `planWorkflow` once plans are live, with a replay test against a recorded history; don't hand-roll version flags — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Temporal's durable timers (`sleep`, `condition(fn, timeout)`) for waiting until the commit deadline, reminders and check-in; don't hand-roll a cron job, a due-items table or `setTimeout` — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Every activity re-reads Postgres and acts only if the plan's state still matches (no reminder unless `confirmed`, no `not_this_time` unless `called_off`, nothing to withdrawn committers) — signals are hints, not state. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Every email is sent through `sendOnce`, with its payload built only from stored data — that's what makes each email go out exactly once and a retry identical. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md), [ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Workflow code imports only `@temporalio/workflow` and types, gets its schedule as epoch milliseconds, and uses neither `Intl` nor JS `Temporal` — workflow code must replay deterministically. ([ADR 0001](docs/adr/0001-temporal-workflow-per-plan.md))
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed in. ([test-strategy](specs/calvin/test-strategy.md))
- Times are stored as UTC `timestamptz`, and every local-time rule and display format goes through `src/domain/time.ts` with `PLAN_TIME_ZONE` — one place for DST and the UX §8.8 formats.
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities. ([ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- Every DST-sensitive rule has a test on 2026-11-01 and 2027-03-14 in `America/Los_Angeles` — that's where local-time rules break.
- `TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database.
- `fileParallelism: false` makes test files run one after another. The time-skipping server's clock is global, so workflow tests must run serially anyway (research/temporal-typescript-sdk.md). Each integration file resets the database before each test.

Binding: CODING_STANDARDS.md, specs/calvin-5/test-strategy.md, specs/calvin-5/architecture.md, docs/adr/0001-temporal-workflow-per-plan.md, docs/adr/0002-postgres-owns-state-temporal-owns-time.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md

## Review Focus

- A reminder dropped at the gathering's start whose workflow must still reach check-in and not fail (Task 4, AC1 test).
- A committer who joined during the retry window, whose own `confirmed` send is refused non-retryably: skipped for the reminder too, never sent a reminder alone (Task 2).
- A workflow started before this deploy (input has no `gatheringAt`): reminders behave as before, no crash (Task 4).
- A history recorded before this change still replays (Task 1 fixture, Task 4 replay test).
- A reminder send that succeeds just before the gathering starts is not dropped, and its 6h-rule bookkeeping (`sent24At`) is untouched (Task 4, AC4 test).

## Rulings

Ruling: Reminder ordering lives in the `sendToCommitters` activity (send `confirmed` first via `sendOnce`), not in the workflow — it needs no `patched()` id, and the ledger already makes the `confirmed` send idempotent — if wrong, a reminder-kind activity test that expects only reminder emails must filter by subject (Task 2 updates the two existing ones).
Ruling: `gatheringAt` joins `Schedule` (a string, like the other instants) rather than a separate argument to `planWorkflows.start` — one value object travels from `computeSchedule` to the workflow input; it costs three existing literal assertions (Task 3).
Ruling: `PlanWorkflowInput.gatheringAt` is optional and an absent value means "don't drop" — workflows started before the deploy keep today's behaviour — if wrong, those plans' reminders can still arrive late.
Ruling: The drop cancels the activity from the workflow (`TRY_CANCEL`); an attempt already inside its 30s `startToCloseTimeout` when the gathering starts may still finish its sends — a heartbeat-based abort needs a clock the activity doesn't have — if wrong, one reminder may arrive up to 30s after the gathering starts.
Ruling: The 24h reminder is dropped at the gathering's start by the same rule as the morning one (the story says "a reminder") — if wrong, a 24h reminder retrying into the gathering would still go out.

---

### Task 1: Record a pre-change history for the replay test

**Covers:** AC4

**Files:**
- Create: `tests/fixtures/workflow/before-reminders-in-time-4-3.json`
- Modify: `tests/workflow/plan-workflow.test.ts` (one replay test)

**Interfaces:**
- Produces: fixture name `before-reminders-in-time-4-3` (a history of the current `planWorkflow` that runs the example plan through both reminders and its check-in), loaded with the existing `loadHistory(name)` helper. Task 4 relies on it replaying cleanly.

No workflow or activity code changes in this task; do it first, while `src/temporal/workflows.ts` is unchanged.

- [ ] **Step 1: Record the history.** Add a temporary `it` at the end of `describe('planWorkflow reminders', ...)` in `tests/workflow/plan-workflow.test.ts` that runs `confirmedPlan()` and `runSchedule(deps, published.planId, { schedule: EXAMPLE, confirmAt: '2026-11-12T18:00:00Z', act: async (h) => { handle = h; } })`, then `proto.temporal.api.history.v1.History.toObject(await handle.fetchHistory(), { longs: String, enums: String, bytes: String })` written with `JSON.stringify(..., null, 2)` to `tests/fixtures/workflow/before-reminders-in-time-4-3.json` (`writeFileSync`). Run it once: `npx vitest run tests/workflow/plan-workflow.test.ts -t "<its name>"`. Expected: PASS and the file exists. Delete the temporary `it` and the `writeFileSync` import.
- [ ] **Step 2: Check the fixture:** it contains `reminder_24h` and `reminder_morning` activity inputs and no `reminders-in-time-4-3` marker: `grep -c reminder_morning tests/fixtures/workflow/before-reminders-in-time-4-3.json` is at least 1, and `grep -c reminders-in-time-4-3` is 0 (the file name aside).
- [ ] **Step 3: Add the replay test** next to `replays a history recorded before reminders-3-3`: `it('replays a history recorded before reminders-in-time-4-3', ...)` asserting `Worker.runReplayHistory({ workflowsPath }, loadHistory('before-reminders-in-time-4-3'))` resolves to `undefined`. Run it: PASS (it passes now by design; Task 4 shows it can fail).
- [ ] **Step 4: Commit** `tests/fixtures/workflow/before-reminders-in-time-4-3.json tests/workflow/plan-workflow.test.ts` — "Record a pre-4.3 history for the replay test".

### Task 2: A reminder reaches a committer only after their "It's on" email

**Covers:** AC3

**Files:**
- Modify: `src/temporal/activities.ts` (`sendToCommitters`, `sendToOne`)
- Test: `src/temporal/activities.test.ts`, `tests/workflow/plan-workflow.test.ts`

**Interfaces:**
- Consumes: `sendOnce(deps, kind, plan, commit, commits)`, `sendOrSkip(planId, kind, send)` (story 4.2, `src/temporal/activities.ts`).
- Produces: for `kind` of `reminder_24h` or `reminder_morning`, both `sendToCommitters` and `sendToOne` send `confirmed` to the committer first, then the reminder, inside one `sendOrSkip` per committer. Other kinds are unchanged.

- [ ] **Step 1: Write the failing activity test** in the `reminders` describe of `src/temporal/activities.test.ts`: `sends a committer their It's on email before their reminder`. Use `threeIn()` (Ann, Mia, Raj; minimum 3, confirmed), then `await commit(...)` Lee (the pattern the file already uses for late commits), with no `confirmed` email sent to anyone yet. Call `activities.sendToCommitters(published.planId, 'reminder_24h')`. Assert the subjects sent to `lee@example.test`, in call order, equal `["It's on: Coffee at Blue Bottle, Sat 14 Nov 10:00 AM", 'Tomorrow: Coffee at Blue Bottle, 10:00 AM']`.
- [ ] **Step 2: Run** `npx vitest run src/temporal/activities.test.ts -t "before their reminder"`. Expected: FAIL (Lee's list is only the `Tomorrow:` subject).
- [ ] **Step 3: Implement** in `src/temporal/activities.ts`: a local `sendWithPrerequisite(deps, kind, plan, commit, commits)` that, when `kind` is a reminder, awaits `sendOnce(deps, 'confirmed', ...)` before `sendOnce(deps, kind, ...)`; use it as the `send` of the existing `sendOrSkip` calls in both activities. Re-run Step 2: PASS.
- [ ] **Step 4: Next test, then code (RED first):** `skips a committer whose It's on email is refused, for the reminder too` — `deps.fakes.email.rejectTo('mia@example.test')`, call `sendToCommitters(..., 'reminder_24h')`, assert `recipients(deps)` contains Ann and Raj (twice each: confirmed and reminder) and no Mia, and the call resolves. Expected to pass with Step 3's code because the pair shares one `sendOrSkip`: show RED by mutating `sendWithPrerequisite` to send the reminder in a second `sendOrSkip`... simplest mutation: swap the two `sendOnce` calls, see the Step 1 test fail, restore.
- [ ] **Step 5: Fix the two existing tests this changes**: `sends the 24h reminder to every active committer, once` expects 3 payloads and `leaves a withdrawn committer out of the morning reminder and the list` reads every payload; make both look only at emails whose subject starts with `Tomorrow:` / `Today:`. `sendToOne sends the reminder only to the named committer` and `a committer who withdraws and rejoins gets exactly one 24h reminder` likewise count only reminder subjects. Run `npx vitest run src/temporal/activities.test.ts`: all PASS.
- [ ] **Step 6: Write the AC3 workflow test** in `describe('planWorkflow reminders', ...)` of `tests/workflow/plan-workflow.test.ts`: `gives Lee his It's on email before any reminder when he commits while the 24h reminder is retrying (AC3)`. Setup: `confirmedPlan()` (Ann, Mia, Raj), `mail = timedEmail(deps, (p) => p.subject.startsWith('Tomorrow:'))`, `runSchedule` with `EXAMPLE`, `confirmAt: '2026-11-12T18:00:00Z'`. In `act(h, shift)`: set `mail.failUntil = Date.parse('2026-11-13T18:20:00Z') + shift` (the 24h send is due `2026-11-13T18:00:00Z` = 10:00 AM PST on Fri 13 Nov, so it fails 10:00–10:20); `await env.sleep(Date.parse('2026-11-13T18:10:00Z') - Date.parse('2026-11-12T18:00:00Z'))`; commit Lee (`form('Lee', 'lee@example.test')`) and `h.signal(committed, lee.commitId)`; `await env.sleep(3_000_000)` (to 19:00Z, past the last retry). Assert Lee's subjects in `mail.records` order equal `["It's on: Coffee at Blue Bottle, Sat 14 Nov 10:00 AM", 'Tomorrow: Coffee at Blue Bottle, 10:00 AM']`, and that every other recipient got exactly one `Tomorrow:`.
- [ ] **Step 7: Run it** `npx vitest run tests/workflow/plan-workflow.test.ts -t "AC3"`. Expected: PASS (Step 3's code). Show it can fail: temporarily make `sendWithPrerequisite` send only the reminder; the test must FAIL with Lee's first subject starting `Tomorrow:`; restore.
- [ ] **Step 8: Run** `npx vitest run src/temporal tests/workflow`: PASS. Commit — "A reminder follows the committer's It's on email".

### Task 3: The schedule carries the gathering's start

**Covers:** AC4

**Files:**
- Modify: `src/domain/plan-rules.ts` (`Schedule`, `computeSchedule`), `src/temporal/client.ts`, `src/temporal/workflows.ts` (`PlanWorkflowInput` only)
- Test: `src/domain/plan-rules.test.ts`, `src/domain/plans.test.ts:126`, `src/web/routes/create.test.ts:69`, `tests/workflow/plan-workflow.test.ts` (`EXAMPLE`, `runSchedule`)

**Interfaces:**
- Produces: `Schedule.gatheringAt: string` (ISO UTC, e.g. `'2026-11-14T18:00:00Z'`); `PlanWorkflowInput.gatheringAt?: number` (epoch ms); `createPlanWorkflows(...).start` passes `epochMs(schedule.gatheringAt)`. Other fields and instants are unchanged.

- [ ] **Step 1: Write the failing test.** In `src/domain/plan-rules.test.ts`, the first `computeSchedule` test's expected object gains `gatheringAt: '2026-11-14T18:00:00Z'`. Run `npx vitest run src/domain/plan-rules.test.ts`. Expected: FAIL (missing field).
- [ ] **Step 2: Implement** `gatheringAt: gatheringAt.toString()` in `computeSchedule`; add the field to `Schedule`. Run: PASS. `npx tsc --noEmit` now fails where a `Schedule` literal is built (`tests/workflow/plan-workflow.test.ts` `EXAMPLE`); continue.
- [ ] **Step 3: Update the other literals:** `src/domain/plans.test.ts:126` and `src/web/routes/create.test.ts:69` gain `gatheringAt: '2026-11-14T18:00:00Z'`; in `tests/workflow/plan-workflow.test.ts` `EXAMPLE` gains the same, the `09:30` test's expected schedule gains `gatheringAt: '2026-11-14T17:30:00Z'`, and `runSchedule` sets `gatheringAt: Date.parse(schedule.gatheringAt) + shift` on the input. Keep `EXAMPLE.checkInAt` as is (`18:01Z`) for existing tests.
- [ ] **Step 4: Add `gatheringAt?: number` to `PlanWorkflowInput`** (`src/temporal/workflows.ts`) and pass it in `createPlanWorkflows.start` (`src/temporal/client.ts`; no automated test at poc, `tsc` checks it).
- [ ] **Step 5: Run** `npx tsc --noEmit && npx vitest run`: PASS. Commit — "Carry the gathering's start in the schedule".

### Task 4: Drop a reminder still retrying when the gathering starts

**Covers:** AC1, AC2, AC4

**Files:**
- Modify: `src/temporal/workflows.ts`
- Test: `tests/workflow/plan-workflow.test.ts`

**Interfaces:**
- Consumes: `input.gatheringAt?: number` (Task 3), the fixture `before-reminders-in-time-4-3` and its replay test (Task 1), `timedEmail` / `runSchedule` / `EXAMPLE` helpers in the test file.
- Produces: inside the `reminders-3-3` block, `const inTime = patched('reminders-in-time-4-3')`, and an inner `sendReminder(kind: 'reminder_24h' | 'reminder_morning'): Promise<boolean>` that returns whether the reminder finished. With `inTime` and `input.gatheringAt` defined it runs `reminders.sendToCommitters(input.planId, kind)` inside `CancellationScope.withTimeout(input.gatheringAt - Date.now(), ...)`; if `input.gatheringAt - Date.now() <= 0` it returns `false` without sending; a cancellation (`isCancellation(e)` and the enclosing scope itself not cancelled) returns `false`; any other error is rethrown. Without `inTime` or `gatheringAt` it behaves as today and returns `true`. `sent24At` is set only when it returns `true`.

Tests below use a schedule override for the AC tests: `{ ...EXAMPLE, checkInAt: '2026-11-15T18:00:00Z' }` (the example plan's real check-in; the gathering is `2026-11-14T18:00:00Z`, 10:00 AM PST) and `confirmAt: '2026-11-12T18:00:00Z'`. Each test fails sends through `timedEmail(deps, failWhen)` with `mail.failUntil = <ISO> + shift` set in `act`, advances with `env.sleep`, and reads `(await h.describe()).status.name` for "still running".

- [ ] **Step 1: Write the AC1 test** `drops the morning reminder that is still retrying when the gathering starts (AC1)`: `failWhen: (p) => p.subject.startsWith('Today:')`, `failUntil = Date.parse('2026-11-14T18:30:00Z') + shift`; in `act`: `await env.sleep(Date.parse('2026-11-14T18:30:00Z') - Date.parse('2026-11-12T18:00:00Z') + 60_000)` then expect status `'RUNNING'` (it waits for the check-in a day later). After `runSchedule` returns (workflow completed at check-in): `startingWith(mail.records, 'Today:')` equals `[]`, and `startingWith(mail.records, 'Tomorrow:')` has length 3.
- [ ] **Step 2: Run** `npx vitest run tests/workflow/plan-workflow.test.ts -t "AC1"`. Expected: FAIL (a `Today:` record at ≥ 18:30Z exists).
- [ ] **Step 3: Implement** `sendReminder` and the `patched('reminders-in-time-4-3')` gate in `src/temporal/workflows.ts` per Interfaces; use it for both reminders in place of the direct `reminders.sendToCommitters` calls (import `CancellationScope`, `isCancellation`). Update the comment above `reminders` ("An exhausted reminder send fails the workflow") to say a reminder still retrying at the gathering's start is dropped. Re-run Step 2: PASS.
- [ ] **Step 4: Write the AC2 test** `drops Raj's morning reminder when his send is still failing at 10:05 AM, and Ann keeps hers (AC2)`: `failWhen: (p) => p.to === 'raj@example.test' && p.subject.startsWith('Today:')`, `failUntil = Date.parse('2026-11-14T18:05:00Z') + shift`; `act` sleeps to `2026-11-14T18:10:00Z`. Assert `startingWith(mail.records, 'Today:')` has exactly one record to `ann@example.test`, one to `mia@example.test` and none to `raj@example.test` (Ann and Mia are sent before Raj in commit order, at `16:00Z`). Run it: PASS with Step 3's code; show it can fail by mutating the scope's timeout to `Infinity`-like (skip the scope) and seeing Raj get a `Today:` record at ≥ 18:05Z; restore.
- [ ] **Step 5: Write the replay mutation check.** Run `npx vitest run tests/workflow/plan-workflow.test.ts -t "before reminders-in-time-4-3"`: PASS. Mutate: delete the `patched(...)` call so `inTime` is always `true`; the replay test must FAIL with a nondeterminism error; restore.
- [ ] **Step 6: Write the no-`gatheringAt` test** `a workflow started without gatheringAt still sends a reminder that went through retries (AC4)`: call `runSchedule` with a schedule, then override: add an `omitGatheringAt?: boolean` option to `runSchedule` that leaves `gatheringAt` off the input; `failWhen` `Today:` until `2026-11-14T18:30:00Z + shift`; assert the `Today:` emails are sent at or after that instant (old behaviour). PASS.
- [ ] **Step 7: Write the AC4 regression test** `sends the reminders at the example instants with the same text (AC4)` (no failures, `confirmAt: '2026-11-12T18:00:00Z'`, schedule with the example plan's gathering): `Tomorrow:` records at `2026-11-13T18:00:00Z` and `Today:` at `2026-11-14T16:00:00Z` (use `expectAt`), subject `'Tomorrow: Coffee at Blue Bottle, 10:00 AM'` / `'Today: Coffee at Blue Bottle, 10:00 AM'`, and each record's `text` equals the body `src/email/templates.test.ts` pins for that kind (`body('Tomorrow', …)` / `body('Today', …)`, read there for the literal and copy it, with Ann, Mia, Raj in).
- [ ] **Step 8: Run** `npx tsc --noEmit && npx vitest run`: all PASS, including `tests/guardrails-source.test.ts` (the new id is named by the replay test from Task 1). Commit — "Drop a reminder still retrying when the gathering starts".
