# One failed send doesn't stop the others — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a send to one committer fails non-retryably, the activity logs it, skips that committer (ledger row stays unsent) and sends to the rest, so the plan workflow carries on.

**Architecture:** The catch lives in `src/temporal/activities.ts`, around each per-committer `sendOnce` call in `sendToCommitters` and `sendToOne`. A failure that is an `ApplicationFailure` with `nonRetryable === true` is logged at `error` and swallowed; anything else is rethrown so Temporal retries as today. `sendOnce` and `planWorkflow` do not change (no `patched()` id, no new replay test), because the workflow only sees an activity that no longer fails.

**Tech Stack:** TypeScript (Node 26 type stripping), Vitest 5, `@temporalio/activity` `ApplicationFailure`, `@temporalio/testing` time-skipping server, the worktree's Postgres.

**Spec:** .factory/story.md (story #252)

## Global Constraints

- Use Temporal's activity retry policy and timeouts (`proxyActivities`, `retry`, `startToCloseTimeout`, `scheduleToCloseTimeout`) for retrying Postgres and Resend calls; don't hand-roll retry loops or backoff — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Temporal's `patched()` / `deprecatePatch()` for any change to `planWorkflow` once plans are live, with a replay test against a recorded history; don't hand-roll version flags — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Every activity re-reads Postgres and acts only if the plan's state still matches (no reminder unless `confirmed`, no `not_this_time` unless `called_off`, nothing to withdrawn committers) — signals are hints, not state. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Every email is sent through `sendOnce`, with its payload built only from stored data — that's what makes each email go out exactly once and a retry identical. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md), [ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Workflow code imports only `@temporalio/workflow` and types, gets its schedule as epoch milliseconds, and uses neither `Intl` nor JS `Temporal` — workflow code must replay deterministically. ([ADR 0001](docs/adr/0001-temporal-workflow-per-plan.md))
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities. ([ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- **Activities** throw on failure so Temporal retries. Non-retryable cases (Resend validation, auth or quota errors) throw `ApplicationFailure.nonRetryable`.
- `TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database.
- `fileParallelism: false` makes test files run one after another. The time-skipping server's clock is global, so workflow tests must run serially anyway (research/temporal-typescript-sdk.md). Each integration file resets the database before each test.

Binding: CODING_STANDARDS.md, specs/calvin-5/test-strategy.md, specs/calvin-5/architecture.md, docs/adr/0001-temporal-workflow-per-plan.md, docs/adr/0002-postgres-owns-state-temporal-owns-time.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md

## Review Focus

- A non-retryable failure for the plan's creator (the first committer): the rest still get their email (Task 1).
- Two committers failing non-retryably in one send: both skipped, both logged, a third still gets theirs (Task 1).
- A non-retryable failure mixed with a retryable one in the same send: the retryable one still throws, and its retry sends to the rest once each (Task 1).
- A non-`ApplicationFailure` error, or an `ApplicationFailure` that is retryable: rethrown, not swallowed (Tasks 1, 2).
- The skipped committer's address or withdraw token leaking into the log line (Task 1).

---

### Task 1: Skip a non-retryable failure in `sendToCommitters`

**Covers:** AC1, AC3

**Files:**
- Modify: `tests/support/fakes.ts` (`fakeEmail`)
- Modify: `src/temporal/activities.ts`
- Test: `src/temporal/activities.test.ts`

**Interfaces:**
- Produces, in `fakeEmail()` (`tests/support/fakes.ts`): `rejectTo(address: string): void` — every later send whose payload `to` equals `address` is recorded in `attempts`, not `calls`, and throws `ApplicationFailure.nonRetryable('Resend send failed: validation_error (422)', 'ResendError')`; `failNextTo(address: string): void` — the next send to `address` is recorded in `attempts` and throws a plain `Error('email send failed')`, later ones succeed. Both leave `failNext()` as it is.
- Produces, in `src/temporal/activities.ts`: an unexported `sendOrSkip(deps, planId, kind, send: () => Promise<void>): Promise<void>` that awaits `send()`; if it throws an `ApplicationFailure` whose `nonRetryable` is `true`, it calls `log.error('email skipped: non-retryable send failure', { planId, kind, errorName: error.type })` and returns; any other error is rethrown. (Task 2 reuses it. `deps` is not needed: drop that parameter if nothing uses it.)
- Consumes: `sendOnce(deps, kind, plan, commit, commits)` from `src/email/send.ts` and `log` from `src/log.ts`, both unchanged.

- [ ] **Step 1: Write the failing test** in `src/temporal/activities.test.ts`, new `describe('a committer whose send fails non-retryably', ...)`, using `setup([['Mia', 'mia@example.test'], ['Raj', 'raj@example.test']])` (Ann, Mia, Raj; minimum 3, so the plan is confirmed). Capture log lines with the `vi.spyOn(process.stdout, 'write')` pattern already used in `src/web/routes/manage.test.ts:326`. Test `skips Mia, sends Ann and Raj once each, and logs the failure`: call `deps.fakes.email.rejectTo('mia@example.test')`, then `await activities.sendToCommitters(published.planId, 'confirmed')` (must resolve, not throw). Assert: `recipients(deps)` equals `['ann@example.test', 'raj@example.test']`; the `email_sends` rows (read with `db.select().from(emailSends)`, the ledger being the AC's subject) for `kind = 'confirmed'` number 3, and exactly Mia's has `sentAt === null`; exactly one captured line parses to an object with `level: 'error'`, `planId: published.planId`, `kind: 'confirmed'` and `errorName: 'ResendError'`; the whole captured output contains neither `mia@example.test` nor Mia's withdraw token (`withdrawTokens[0]`).
- [ ] **Step 2: Run** `npx vitest run src/temporal/activities.test.ts -t "skips Mia"`. Expected: FAIL (`rejectTo` is not a function).
- [ ] **Step 3: Add `rejectTo` and `failNextTo` to `fakeEmail`** in `tests/support/fakes.ts` per Interfaces (import `ApplicationFailure` from `@temporalio/activity`, as `src/email/send-email.ts` does). Re-run: now FAIL because `sendToCommitters` rejects with the `ApplicationFailure`.
- [ ] **Step 4: Implement `sendOrSkip`** in `src/temporal/activities.ts` per Interfaces and wrap the `sendOnce` call inside the `for` loop of `sendToCommitters` with it. Re-run Step 2's command: PASS.
- [ ] **Step 5: Next test, then code (each RED first):**
  - `still throws a retryable failure` (AC3's activity half; Review Focus 3, 4): `failNextTo('mia@example.test')`; `sendToCommitters(..., 'confirmed')` rejects; Ann has been sent, `attempts` holds Ann and Mia; calling `sendToCommitters` again resolves and `recipients(deps)` equals `['ann@example.test', 'mia@example.test', 'raj@example.test']`, each once. Should pass at once with Step 4's code: show it RED by mutating `sendOrSkip` to swallow every error, then revert.
  - `skips two failing committers and still sends the third` (Review Focus 2): `rejectTo` Ann's and Raj's addresses (`ann@example.test`, `raj@example.test`) in a plan of Ann, Mia, Raj; only Mia is sent; two `error` lines are logged. Also covers Review Focus 1 (the creator is Ann, first in the loop).
  - `rethrows a retryable ApplicationFailure and a plain error` is covered by the retryable test above (plain `Error`); add a case where the fake throws `ApplicationFailure.retryable('x', 'ResendError')` through a one-off `sendEmail` passed to `createActivities` (system-boundary fake, not a mock of a project file) and assert the activity rejects.
  - `a non-retryable Mia plus a retryable Raj` (Review Focus 3): `rejectTo` Mia, `failNextTo` Raj; first call rejects having sent Ann only; second call resolves with Raj sent, Mia still unsent, and no second email to Ann.
- [ ] **Step 6: Run** `npx tsc --noEmit && npx vitest run src/temporal/activities.test.ts`. Expected: no type errors, all PASS.
- [ ] **Step 7: Commit**

```bash
git add tests/support/fakes.ts src/temporal/activities.ts src/temporal/activities.test.ts
git commit -m "Skip a committer whose send fails non-retryably"
```

### Task 2: Skip a non-retryable failure in `sendToOne`

**Covers:** AC4

**Files:**
- Modify: `src/temporal/activities.ts`
- Test: `src/temporal/activities.test.ts`

**Interfaces:**
- Consumes: `sendOrSkip` from Task 1 and `fakeEmail().rejectTo`.
- Produces: `sendToOne(planId, kind, commitId)` resolves, logging as in Task 1, when the one send fails non-retryably.

- [ ] **Step 1: Write the failing test** in the `sendToOne` describe of `src/temporal/activities.test.ts`: `skips a late committer whose send fails non-retryably`. `setup` Mia and Raj, commit Lee (as the existing `sends only to the named active committer` test does), `rejectTo('lee@example.test')`, `await activities.sendToOne(published.planId, 'confirmed', lee.commitId)` resolves; `recipients(deps)` is `[]`; Lee's `email_sends` row has `sentAt === null`; one `error` line with `kind: 'confirmed'` and no `lee@example.test` in the output.
- [ ] **Step 2: Run** `npx vitest run src/temporal/activities.test.ts -t "late committer whose send"`. Expected: FAIL, the activity rejects.
- [ ] **Step 3: Wrap the `sendOnce` call in `sendToOne`** with `sendOrSkip`. Re-run: PASS.
- [ ] **Step 4: Next test, RED first:** `sendToOne rethrows a plain error` — `failNextTo('lee@example.test')` and the call rejects (Review Focus 4). Passes at once; show it fails by the Task 1 mutation (swallow every error), then revert.
- [ ] **Step 5: Run** `npx tsc --noEmit && npx vitest run src/temporal/activities.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add src/temporal/activities.ts src/temporal/activities.test.ts
git commit -m "Skip a late committer whose send fails non-retryably"
```

### Task 3: Workflow tests for every email the workflow sends

**Covers:** AC2, AC3, AC4, AC5

**Files:**
- Test: `tests/workflow/plan-workflow.test.ts`

**Interfaces:**
- Consumes: `fakeEmail().rejectTo` / `failNextTo` (Task 1); `confirmedPlan()`, `run()`, `runSchedule()`, `timedEmail()`, `EXAMPLE`, `waitForEmails`, `startingWith`, `sent` already in that file.
- Produces: nothing; `src/` does not change in this task.

The tests below pass as soon as Tasks 1 and 2 are in, so each is shown to fail by a mutation: in `src/temporal/activities.ts` make `sendOrSkip` rethrow every error, run the test, see it fail, then revert. Record each mutation's failing run in the commit message.

Worked numbers: the example plan is Ann (creator), Mia, Raj, minimum 3, confirmed at `2026-11-12T18:00:00Z` with `EXAMPLE`. Mia's sends all fail, so the workflow records 2 `confirmed`, 2 `Tomorrow:` (24h, `2026-11-13T18:00:00Z`) and 2 `Today:` (morning, `2026-11-14T16:00:00Z`) emails, 6 in all, to Ann and Raj. From confirmation to the morning reminder is 46h, so `46h + 1h = 169_200_000` ms is after both reminders and before the check-in at `2026-11-14T18:01:00Z` (48h01m after confirmation).

- [ ] **Step 1: Test `carries on to the reminders when one committer's address is refused (AC2)`**, in `describe('planWorkflow reminders')`. `confirmedPlan()`, `deps.fakes.email.rejectTo('mia@example.test')`, `timedEmail(deps)`, then `runSchedule(deps, published.planId, { schedule: EXAMPLE, confirmAt: '2026-11-12T18:00:00Z', sendEmail: mail.send, act: async (h) => { await env.sleep(169_200_000); expect((await h.describe()).status.name).toBe('RUNNING'); } })`. Assert `mail.records` has 6 entries; those starting with `It's on:`, `Tomorrow:` and `Today:` each go to `['ann@example.test', 'raj@example.test']` (sorted), none to Mia. Run: PASS; mutate and see FAIL.
- [ ] **Step 2: Test `sends each committer exactly one confirmation when a send to Mia fails once and is retried (AC3)`**, in `describe('planWorkflow confirmed phase')`. `confirmedPlan()`, `failNextTo('mia@example.test')`, `run(deps, published.planId, 3_600_000, (h) => h.signal(confirmed))`. Assert `sent(deps).map((e) => e.to).sort()` equals `['ann@example.test', 'mia@example.test', 'raj@example.test']`.  Mutation for this one: make `sendOrSkip` swallow every error and see Mia's email missing.
- [ ] **Step 3: Test `a late commit whose send is refused leaves the workflow running and the next reminder reaches everyone else (AC4)`**, in `describe('planWorkflow reminders')`. `confirmedPlan()`, `rejectTo('lee@example.test')`, `timedEmail(deps)`; `runSchedule` with `act: async (h) => { await waitForEmails(deps, 3); const lee = await commit(deps, published.publicToken, form('Lee', 'lee@example.test')); if (lee.outcome !== 'committed') throw new Error('Lee should commit'); await h.signal(committed, lee.commitId); await env.sleep(3_600_000); expect((await h.describe()).status.name).toBe('RUNNING'); }`. After it: the `Tomorrow:` records go to `['ann@example.test', 'mia@example.test', 'raj@example.test']` (sorted) and no email went to Lee (`mail.records.some((r) => r.to === 'lee@example.test')` is false).
- [ ] **Step 4: Test `sends Not this time to every other committer when the send to Mia is refused (AC5)`**, in `describe('planWorkflow open phase')`. `publishPlan(deps, { minimum: '4' })`, commit Mia and Raj, `rejectTo('mia@example.test')`, `run(deps, published.planId)` (deadline 1h later, the plan is below its minimum, so it is called off). Assert `sent(deps).map((e) => e.to)` equals `['ann@example.test', 'raj@example.test']` and every subject is `'Not this time: Coffee on Sat 14 Nov'`.
- [ ] **Step 5: Run** `npx vitest run tests/workflow/plan-workflow.test.ts`. Expected: all PASS, then `npx vitest run && npx tsc --noEmit`. Expected: PASS, including `tests/guardrails-source.test.ts` (no new `patched()` id).
- [ ] **Step 6: Commit**

```bash
git add tests/workflow/plan-workflow.test.ts
git commit -m "Workflow tests: one refused address doesn't stop the others"
```

## Rulings

Ruling: log `errorName` as the `ApplicationFailure`'s `type` (`ResendError` in production), not Resend's own error name — `createSendEmail` puts Resend's name only in the message, and parsing the message is fragile — if wrong, the line says less than "validation_error" and a follow-up adds the name to the failure's `details`.
Ruling: a retryable failure after a non-retryable skip in the same send rethrows at once, so the retry attempts the skipped committer again and logs its failure again — the story says retryable failures behave as today — if wrong, an operator sees a repeated `error` line per retry.
Ruling: `planWorkflow` and `sendOnce` are unchanged, so no `patched()` id and no replay fixture — the swallow sits entirely in the activity, which Temporal does not replay — if wrong, a recorded history with a failed activity would differ, but the old workflows never recorded a skipped send.
Ruling: the activity tests read `email_sends` directly to show Mia's row is unsent — the ledger row is the subject of AC1 and no domain function exposes it — if wrong, a later `domain/` reader replaces those lines.
