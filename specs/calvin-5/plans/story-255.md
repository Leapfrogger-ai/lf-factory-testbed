# The check-in email — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At the check-in time a confirmed plan's workflow sends `check_in` to the creator only, once, through the send ledger, and ends; a plan called off gets none.

**Architecture:** A `check_in` template in `buildEmail`, a new activity `sendCheckIn(planId)` that sends it to the active creator only if the plan is still `confirmed`, and a new `patched('check-in-4-5')` step in `planWorkflow` replacing the placeholder end of the confirmed phase (after the existing `waitUntil(checkInAt)` and `endedByCallOff()`), with its own replay test against a history recorded before the change.

**Tech Stack:** TypeScript (Node 26 type stripping), Vitest 5, `@temporalio/workflow` (`patched`), `@temporalio/testing` time-skipping server, the worktree's Postgres.

**Spec:** .factory/story.md (story #255)

## Global Constraints

- Use Temporal's durable timers (`sleep`, `condition(fn, timeout)`) for waiting until the commit deadline, reminders and check-in; don't hand-roll a cron job, a due-items table or `setTimeout` — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Temporal's activity retry policy and timeouts (`proxyActivities`, `retry`, `startToCloseTimeout`, `scheduleToCloseTimeout`) for retrying Postgres and Resend calls; don't hand-roll retry loops or backoff — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Temporal's `patched()` / `deprecatePatch()` for any change to `planWorkflow` once plans are live, with a replay test against a recorded history; don't hand-roll version flags — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use `@temporalio/testing`'s `TestWorkflowEnvironment.createTimeSkipping()` to test the plan workflow's timers; don't fake clocks or mock `sleep` — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Resend's idempotency keys (`emails.send(payload, { idempotencyKey })`) so a retried activity doesn't re-send; don't hand-roll send-then-check — [finding](specs/calvin/research/resend.md).
- Use Resend's tags (`{ name: "kind", value: <kind> }`) to mark each email's kind — [finding](specs/calvin/research/resend.md).
- Every activity re-reads Postgres and acts only if the plan's state still matches (no reminder unless `confirmed`, no `not_this_time` unless `called_off`, nothing to withdrawn committers) — signals are hints, not state. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Every email is sent through `sendOnce`, with its payload built only from stored data — that's what makes each email go out exactly once and a retry identical. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md), [ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Workflow code imports only `@temporalio/workflow` and types, gets its schedule as epoch milliseconds, and uses neither `Intl` nor JS `Temporal` — workflow code must replay deterministically. ([ADR 0001](docs/adr/0001-temporal-workflow-per-plan.md))
- Times are stored as UTC `timestamptz`, and every local-time rule and display format goes through `src/domain/time.ts` with `PLAN_TIME_ZONE` — one place for DST and the UX §8.8 formats.
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed in. ([test-strategy](specs/calvin/test-strategy.md))
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities. ([ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- `TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database.
- `fileParallelism: false` makes test files run one after another. The time-skipping server's clock is global, so workflow tests must run serially anyway (research/temporal-typescript-sdk.md). Each integration file resets the database before each test.
- This worktree's ports and database come from `FACTORY_PORT_BASE` (Temporal test server `FACTORY_PORT_BASE + 1`, Postgres `FACTORY_PORT_BASE + 2`) and `FACTORY_DB_NAME` (default `calvin_test`); tests start their own Postgres and never read `.env`. ([test-strategy](specs/calvin-5/test-strategy.md))

Binding: CODING_STANDARDS.md, specs/calvin-5/test-strategy.md, docs/adr/0001-temporal-workflow-per-plan.md, docs/adr/0002-postgres-owns-state-temporal-owns-time.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md

## Review Focus

- The creator is the only recipient even when many committers are active and some joined late (Task 2 test; Task 3 AC5 test).
- A plan called off after confirmation, signal delivered or lost, gets no check-in (Task 3: the existing call-off tests gain a "no `Did it happen?`" assertion).
- Existing workflow tests that count every email of a confirmed plan now also see Ana's check-in (Task 3, step 6).
- A check-in whose send fails and is retried after a lost first attempt: one email, one `email.sent` event (Task 2 retry test, Task 3 AC4 test).
- A history recorded before this change (placeholder end) must replay (Task 3 replay test).

## Rulings

Ruling: The body ends with a trailing newline, as `confirmed`, `not_this_time` and `manage_link` do — the story's fenced block can't show it, and the other templates are the only precedent — if wrong, one `''` line removed from the template and its test.
Ruling: The subject is `Did it happen? ${Format} on ${day}` (same capitalised format and `formatDay` as `not_this_time`); the body's first lines use `firstName(commit.name)` and `${format} at ${plan.venue}` — they reproduce "Coffee on Sat 14 Nov" and "Coffee at Blue Bottle" for the example — if wrong, copy changes only in `templates.ts`.
Ruling: A new activity `sendCheckIn(planId)` rather than `sendToOne` because the workflow does not know the creator's commit id and `sendToCommitters` would email everyone — if wrong, none: it only selects the creator.
Ruling: With every kind now having a template, `buildEmail`'s "No email template for" guard and its test `throws for a kind without a template` are removed (the guard would be unreachable and the test's only subject, `check_in`, is now valid). `activities.test.ts`'s `throws for a kind the activity does not support` uses `manage_link` and stays.
Ruling: The check-in uses the default `activities` proxy (12h `scheduleToCloseTimeout`), not `reminders`: there is no gathering to drop it for — if wrong, a send failing for 12h fails the workflow, which is after the day it matters.
Ruling: `tests/workflow/plan-workflow.test.ts` tests that run a confirmed plan to its check-in time and count all emails now also see Ana's check-in; they are updated to exclude subjects starting `Did it happen?` rather than to change their schedules — if wrong, the counts are off by one in those tests only.
Ruling: Fixture numbers: `EXAMPLE.checkInAt` in the workflow tests is a placeholder (`2026-11-14T18:01:00Z`); this story's tests use `{ ...EXAMPLE, checkInAt: '2026-11-15T18:00:00Z' }` (as the reminder tests already do), confirmed at `2026-11-12T18:00:00Z` (the minimum of 3 is reached by Ann, Mia and Raj) — the 24h reminder is `2026-11-13T18:00:00Z`, the morning one `2026-11-14T16:00:00Z`. For AC4 the first attempt is at the check-in instant and fails until 2s after it; the retry (5s initial interval) lands after that and succeeds.

---

### Task 1: The check-in email text

**Covers:** AC1, AC2

**Files:**
- Modify: `src/email/templates.ts` (`buildEmail`)
- Test: `src/email/templates.test.ts`

**Interfaces:**
- Consumes: the file's `plan` and `commit(isCreator)` fixtures (plan `checkInToken: 'checkintokencheckintoken'`, venue Blue Bottle, gathering `2026-11-14T18:00:00Z`; the creator is "Casey Creator", the joiner "Pat Joiner").
- Produces: `buildEmail('check_in', plan, commit, baseUrl)` returns `{ to: commit.email, subject, text, tags: [{ name: 'kind', value: 'check_in' }] }`. Task 2 sends it through `sendOnce`.

- [ ] **Step 1: Write the failing tests** in a new `describe('buildEmail check_in')`, one at a time:
  - `builds the subject and exact body for the creator (AC1)`: `buildEmail('check_in', plan, commit(true), 'https://example.test')` has subject `Did it happen? Coffee on Sat 14 Nov`, `to` `casey@example.test`, tags `[{ name: 'kind', value: 'check_in' }]`, and text `toBe` the lines `Hi Casey,` / `Coffee at Blue Bottle was yesterday. Two quick taps, please.` / `Did it happen?` / `Yes: https://example.test/c/checkintokencheckintoken/happened/yes` / `No: …/happened/no` / `Were you there?` / `Yes: …/attended/yes` / `No: …/attended/no` / `Thanks!` joined by `\n` plus a trailing `\n`.
  - `has no withdraw URL and no other committer's name (AC2)`: with a joiner commit too, text not contain `/w/`, `withdrawtokenwithdrawtoken`, `Pat`.
- [ ] **Step 2: Run** `npx vitest run src/email/templates.test.ts -t "check_in"`. Expected: FAIL (`No email template for check_in`).
- [ ] **Step 3: Implement** the `check_in` branch in `buildEmail` in `src/email/templates.ts` (subject and body per the story; links are `${baseUrl}/c/${plan.checkInToken}/{happened,attended}/{yes,no}`), and remove the "No email template" guard. Delete the test `throws for a kind without a template` in `templates.test.ts`.
- [ ] **Step 4: Run** `npx tsc --noEmit && npx vitest run src/email`. Expected: PASS.
- [ ] **Step 5: Commit** `src/email/templates.ts src/email/templates.test.ts` — "Add the check-in email text".

### Task 2: An activity that sends the check-in to the creator

**Covers:** AC1, AC3, AC4, AC5

**Files:**
- Modify: `src/temporal/activities.ts` (`REQUIRED_STATE`, `createActivities`)
- Test: `src/temporal/activities.test.ts`

**Interfaces:**
- Consumes: `buildEmail('check_in', …)` via `sendOnce` (Task 1); `loadSendTargets(db, planId)` (returns `{ plan, commits }`, active commits only); the file's `setup`, `sent(deps)` helpers.
- Produces: `activities.sendCheckIn(planId: string): Promise<void>` — if the plan is `confirmed`, sends `check_in` through `sendOnce` to the active commit with `isCreator`, else nothing; non-retryable failures go through `sendOrSkip`. `REQUIRED_STATE.check_in = 'confirmed'`. Task 3 calls it.

- [ ] **Step 1: Write the failing test** in a new `describe('sendCheckIn')`: `sends one check-in to the creator only, and an email.sent event with kind check_in (AC1, AC5)` — a confirmed plan (Ann, Mia, Raj via the file's `setup`) plus a late committer Lee (`commit(...)` as the file's other tests do); after `await activities.sendCheckIn(planId)`, `sent(deps)` is exactly one email, to `ann@example.test`, subject `Did it happen? Coffee on Sat 14 Nov`, and `db.select().from(events).where(eq(events.type, 'email.sent'))` has one row whose `data.kind` is `check_in` (the `confirmed` sends are not in this test: send nothing else first).
- [ ] **Step 2: Run** `npx vitest run src/temporal/activities.test.ts -t sendCheckIn`. Expected: FAIL (`sendCheckIn is not a function`).
- [ ] **Step 3: Implement** `sendCheckIn` and the `REQUIRED_STATE` entry; the creator is `commits.find((c) => c.isCreator)`, nothing is sent if the plan's state differs or there is no active creator. Re-run: PASS.
- [ ] **Step 4: Write the next tests**, each shown RED first by a mutation or an absent branch (e.g. drop the state check, or send to all commits), then restored:
  - `sends nothing for an open or called-off plan (AC3)` (a plan called off through `callOff(deps, manageToken)`; zero emails).
  - `a retry after a failed first send still sends exactly one email (AC4)`: a `deps.sendEmail` that throws `new Error('email send failed')` once, then delegates; call `sendCheckIn` twice (the second as Temporal's retry), catching the first rejection; one email to Ann in the fake mailbox, one `email.sent` event.
  - `is idempotent`: two successful calls leave one email.
- [ ] **Step 5: Run** `npx tsc --noEmit && npx vitest run src/temporal`. Expected: PASS. Commit `src/temporal/activities.ts src/temporal/activities.test.ts` — "Add a sendCheckIn activity".

### Task 3: The workflow sends the check-in and ends

**Covers:** AC1, AC3, AC4, AC5, AC6

**Files:**
- Create: `tests/fixtures/workflow/before-check-in-4-5.json`
- Modify: `src/temporal/workflows.ts` (end of the `reminders-3-3` block), `tests/workflow/plan-workflow.test.ts`

**Interfaces:**
- Consumes: `activities.sendCheckIn(planId)` (Task 2); the existing helpers in the test file: `confirmedPlan()`, `runSchedule(deps, planId, { schedule, confirmAt, sendEmail?, act })` (returns the clock `shift`), `timedEmail(deps, failWhen)` (`.send`, `.records` with `to`, `subject`, `text`, `at`, `.failUntil`), `startingWith`, `expectAt`, `waitForEmails`, `EXAMPLE`, `loadHistory`, and `PAST_CHECK_IN`, `EVERYONE` inside `describe('planWorkflow call-off')`.
- Produces: in `planWorkflow`, after `if (await endedByCallOff()) return;` that follows `waitUntil(input.checkInAt, stopOnCallOff)`: `if (patched('check-in-4-5')) await activities.sendCheckIn(input.planId);` replacing the placeholder comment. Without the patch (an old history) the workflow behaves as before. Fixture name `before-check-in-4-5`.

Do Step 1 first, while `src/temporal/workflows.ts` is unchanged.

- [ ] **Step 1: Record the history.** A temporary `it` (same recipe as how `before-call-off-from-db-4-4.json` was recorded: `proto.temporal.api.history.v1.History.toObject(await handle.fetchHistory(), { longs: String, enums: String, bytes: String })` written with `JSON.stringify(..., null, 2)` via `writeFileSync`) runs `confirmedPlan()` through `runSchedule` with `{ ...EXAMPLE, checkInAt: '2026-11-15T18:00:00Z' }`, `confirmAt: '2026-11-12T18:00:00Z'`, no call-off, to the end. Run it once, delete it, check `grep -c "reminder" tests/fixtures/workflow/before-check-in-4-5.json` is at least 1.
- [ ] **Step 2: Add the replay test** after the other replay tests: `replays a history recorded before check-in-4-5` asserting `Worker.runReplayHistory({ workflowsPath }, loadHistory('before-check-in-4-5'))` resolves to `undefined`. Run: PASS now (shown able to fail in Step 7).
- [ ] **Step 3: Write the failing AC1 test** in a new `describe('planWorkflow check-in')`: `sends Ana one check-in at the check-in time and ends (AC1, AC5)` — `confirmedPlan()`, `timedEmail`, `runSchedule` with `{ ...EXAMPLE, checkInAt: '2026-11-15T18:00:00Z' }`, `confirmAt: '2026-11-12T18:00:00Z'`, no `act` (time-skipping runs to the end). Assert `startingWith(mail.records, 'Did it happen?')` has length 1, to `ann@example.test`, subject `Did it happen? Coffee on Sat 14 Nov`, `text` `toBe` the story's body with `Hi Ann,` and `plan.checkInToken` / `TEST_BASE_URL` in the links, `expectAt(at, '2026-11-15T18:00:00Z', shift)`; and `db.select().from(events).where(eq(events.type, 'email.sent'))` has a row whose `data.kind` is `check_in`; the workflow completed (`runSchedule` resolving means `handle.result()` did).
- [ ] **Step 4: Run** `npx vitest run tests/workflow/plan-workflow.test.ts -t "(AC1, AC5)"`. Expected: FAIL (no `Did it happen?` record). Then **implement** the `patched('check-in-4-5')` send in `src/temporal/workflows.ts` as under Interfaces; re-run: PASS.
- [ ] **Step 5: Write the next tests**, one at a time (each passes at once after Step 4, so show it fails by a mutation, then restore):
  - `sends no check-in for a plan called off at its deadline (AC3)`: a plan below its minimum (`publishPlan(deps, { minimum: '4' })` with Mia and Raj, as `calls off a plan below its minimum at the deadline` does), started with `run(...)`; assert no email subject starts `Did it happen?`. Mutation: temporarily drop the state check in `sendCheckIn` and call it right after the deadline's call-off branch, see it FAIL, restore.
  - `sends no check-in to a plan called off after confirmation (AC3)`: in `describe('planWorkflow call-off')`, extend the three existing call-off tests (`…(AC2)`, `sends no morning reminder or check-in after a call-off between the two reminders`, and the signal-lost AC1/AC2 tests) with `expect(startingWith(mail.records, 'Did it happen?')).toEqual([])`. Mutation: send the check-in before `endedByCallOff()`.
  - `a first check-in send that fails retryably is retried and Ana still gets one email (AC4)`: `timedEmail(deps, (p) => p.subject.startsWith('Did it happen?'))`; in `act`, `mail.failUntil = Date.parse('2026-11-15T18:00:00Z') + shift + 2000`; assert exactly one check-in record to Ann, with `at` after that `failUntil`.
  - `sends the check-in to Ana only when a committer joined after the 24h reminder (AC5)`: copy the setup of `gives a committer who joins after the 24h reminder the confirmation and the morning one only` (late commit signalled with `committed`, after the three `Tomorrow:` records); assert the `Did it happen?` records are exactly one, to Ann.
- [ ] **Step 6: Fix the tests the new send changes.** Run `npx vitest run tests/workflow src/temporal`. Every confirmed-plan test that counts all emails (those using `run()`: checkInAt is 3h after start, so the check-in now goes out — `sends it once each when the confirmed signal arrives twice`, `confirms at the deadline…`, `sends the confirmed email to everyone…`, `gives a late commit…`, and any reminder test asserting a total) now sees one more email to Ann. Exclude subjects starting `Did it happen?` in those assertions (a small helper in the test file), without changing what they pin.
- [ ] **Step 7: Show the replay test can fail.** Temporarily remove the `patched('check-in-4-5')` guard (always call `sendCheckIn`) and run `-t "replays a history recorded before check-in-4-5"`: FAIL with a nondeterminism error. Restore the guard; PASS.
- [ ] **Step 8: Run** `npx tsc --noEmit && npx vitest run`: all PASS (`tests/patched-ids.test.ts` checks that the new id is named by the replay test and its fixture). Commit `src/temporal/workflows.ts tests/workflow/plan-workflow.test.ts tests/fixtures/workflow/before-check-in-4-5.json` — "The workflow sends the check-in".
