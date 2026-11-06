# Reminders before the gathering (story 3.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a plan is confirmed, send the 24h reminder (frame E3) and the morning reminder (frame E4) to the active committers at the scheduled instants, applying the skip rules of FR020 and FR021.

**Architecture:** Two new email kinds (`reminder_24h`, `reminder_morning`, already in the DB enum) get bodies in `buildEmail`. The existing `sendToCommitters` / `sendToOne` activities accept them (state must be `confirmed`). `planWorkflow` replaces its placeholder confirmed-phase wait with the reminder timers, behind `patched()`, handling `committed` signals while it waits, and records when the 24h reminder actually went out to apply the 6h morning-skip rule.

**Tech Stack:** TypeScript on Node 26, Temporal (`@temporalio/workflow`, time-skipping test env), Drizzle/Postgres, vitest.

**Spec:** .factory/story.md (story #197)

## Global Constraints

- Workflow code imports only `@temporalio/workflow` and types, gets its schedule as epoch milliseconds, and uses neither `Intl` nor JS `Temporal` — workflow code must replay deterministically. ([ADR 0001](docs/adr/0001-temporal-workflow-per-plan.md))
- Every activity re-reads Postgres and acts only if the plan's state still matches (no reminder unless `confirmed`, no `not_this_time` unless `called_off`, nothing to withdrawn committers) — signals are hints, not state. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Every email is sent through `sendOnce`, with its payload built only from stored data — that's what makes each email go out exactly once and a retry identical. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md), [ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Plan and commit state changes only in `src/domain/plans.ts`, inside a transaction that locks the plan row and appends its event through `appendEvent` — one source of truth, and commit races settle on the row lock. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Times are stored as UTC `timestamptz`, and every local-time rule and display format goes through `src/domain/time.ts` with `PLAN_TIME_ZONE` — one place for DST and the UX §8.8 formats.
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed in. ([test-strategy](specs/calvin/test-strategy.md))
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Use Temporal's `patched()` / `deprecatePatch()` for any change to `planWorkflow` once plans are live, with a replay test against a recorded history; don't hand-roll version flags — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Temporal's durable timers (`sleep`, `condition(fn, timeout)`) for waiting until the commit deadline, reminders and check-in; don't hand-roll a cron job, a due-items table or `setTimeout` — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use `@temporalio/testing`'s `TestWorkflowEnvironment.createTimeSkipping()` to test the plan workflow's timers; don't fake clocks or mock `sleep` — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Node 26's JS `Temporal` (`Temporal.ZonedDateTime` in `America/Los_Angeles`) for all local-time math; don't do manual offset math or add `date-fns-tz` or `luxon` — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Resend's tags (`{ name: "kind", value: <kind> }`) to mark each email's kind — [finding](specs/calvin/research/resend.md).
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- Every DST-sensitive rule has a test on 2026-11-01 and 2027-03-14 in `America/Los_Angeles` — that's where local-time rules break.
- Activity options: `startToCloseTimeout: "30s"`, `scheduleToCloseTimeout: "12h"` (well inside Resend's 24h key window), `retry: { initialInterval: "5s", backoffCoefficient: 2, maximumInterval: "10m" }`. (`specs/calvin-4/architecture.md`; see Ruling 2 for the reminders)
- Email kinds are a snake_case string union (`reminder_24h`, `reminder_morning`); signals are camelCase (`confirmed`, `committed`, `calledOff`). (`specs/calvin-4/architecture.md`)
- Test isolation: ports derive from `FACTORY_PORT_BASE` (Postgres on `FACTORY_PORT_BASE + 2`, default 20002) and the test database is `FACTORY_DB_NAME` (default `calvin_test`); never hard-code either, and `TEST_DATABASE_URL` is built only in `vitest.config.ts`. (`specs/calvin-4/test-strategy.md`)
- Tests: TDD for every task (poc): a failing test (RED), then the code that passes it (GREEN).

Binding: CODING_STANDARDS.md, GLOSSARY.md, docs/adr/0001-temporal-workflow-per-plan.md, docs/adr/0002-postgres-owns-state-temporal-owns-time.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md, specs/calvin-4/test-strategy.md, specs/calvin-4/architecture.md

## Review Focus

- A plan with only the creator active (minimum 1): "Who's in: Ann." with no stray comma, and the creator's copy has no withdraw line.
- A venue or city with spaces or `&`: the Map URL stays encoded exactly as in the confirmed email (shared helper), so reminders and E1 never disagree.
- A committer who withdrew *and rejoined* before the 24h reminder: gets exactly one 24h reminder (ledger), and a rejoin signalled after it gets no 24h at all.
- A plan called off (state `called_off`) when a reminder timer fires: the activity sends nothing (state check), even though the workflow still wakes.
- A reminder whose recipient list is empty (everyone withdrew): the activity sends nothing and the workflow carries on to the next timer.

## Rulings

Ruling 1: Reminder bodies keep the blank lines of `epics.md` Story 3.3 and frames E3/E4 (blank line after the Map line and after the "Who's in" line); `.factory/story.md`'s code block shows them without blank lines — the story block looks whitespace-collapsed from `epics.md`, which the operator approved (#191 item 5), and Story 3.2's E1 body is built the same way — if wrong, it costs deleting two `''` entries in one template branch and the tests that pin them.

Ruling 2: The reminder activities use their own `proxyActivities` options with `scheduleToCloseTimeout: '20h'` instead of 12h — AC6 requires the 24h reminder's send to keep retrying from Fri 10:00 until Sat 03:00 (17h) and then succeed, which 12h would cut off at 22:00 Fri; 20h is still inside Resend's 24h idempotency-key window, so retries stay exactly-once — if wrong, a reminder that can't be sent retries 8h longer before the workflow gives up, and the architecture's 12h constant is no longer uniform.

Ruling 3: Workflow tests can't start the clock at 2026-11-13, so they shift the example plan's literal schedule by a constant so that the confirmation moment equals the test environment's "now", then assert each send's time as the ISO literal plus that same shift (±2s). The literal instants themselves are pinned by `plan-rules.test.ts` (already present for the example plan and the 2026-11-01 fall-back day) — if wrong, a bug that shifts instants uniformly would go unseen, but `computeSchedule` is covered separately.

Ruling 4: A reminder activity that exhausts its retries fails the workflow (no `try/catch` around it); Story 3.3 doesn't say otherwise and the check-in (Epic 4) isn't built yet — if wrong, a dead email provider for 20h ends the plan's workflow early.

---

### Task 1: Reminder email bodies

**Covers:** AC2

**Files:**
- Modify: `src/domain/time.ts` (add `formatClock`)
- Modify: `src/email/templates.ts` (`buildEmail` handles `reminder_24h`, `reminder_morning`; share the Map-URL line with the `confirmed` branch)
- Test: `src/domain/time.test.ts`, `src/email/templates.test.ts`

**Interfaces:**
- Consumes: `buildEmail(kind, plan, commit, baseUrl, activeCommits)` as it exists; `firstName` from `src/web/views/public-plan-page.ts`.
- Produces: `formatClock(instant: Temporal.Instant): string` → `10:00 AM` (PLAN_TIME_ZONE, UX §8.8 clock); `buildEmail` returning for the two new kinds `{ to, subject, text, tags: [{ name: 'kind', value: kind }] }`.

- [ ] **Step 1: Write failing tests** in `src/domain/time.test.ts`: `formatClock(Temporal.Instant.from('2026-11-14T18:00:00Z'))` is `'10:00 AM'`; `'2026-11-14T21:30:00Z'` is `'1:30 PM'`; `'2026-11-01T18:00:00Z'` (fall-back day) is `'10:00 AM'`; `'2027-03-14T18:00:00Z'` (spring-forward day, PDT) is `'11:00 AM'`.
- [ ] **Step 2: Run** `npx vitest run src/domain/time.test.ts` — Expected: FAIL, `formatClock` is not exported.
- [ ] **Step 3: Implement `formatClock`** in `src/domain/time.ts` returning `displayParts(instant).clock`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Write failing tests** in `src/email/templates.test.ts`, using the example plan (Ann creator, Mia, Raj; venue Blue Bottle, Oakland, coffee, Sat 14 Nov 10:00) built the way the file's existing `confirmed` tests build it:
  - Mia's `reminder_24h`: `subject` is `Tomorrow: Coffee at Blue Bottle, 10:00 AM`; `text` is exactly `["Tomorrow at 10:00 AM: Coffee at Blue Bottle, Oakland.", "Map: https://maps.google.com/?q=Blue+Bottle+Oakland", "", "Who's in: Ann, Mia, Raj.", "", "Can't make it? Withdraw: " + base + "/w/" + miaToken, ""].join('\n')`; `tags` equal `[{ name: 'kind', value: 'reminder_24h' }]`.
  - Mia's `reminder_morning`: subject `Today: Coffee at Blue Bottle, 10:00 AM`; text identical except it starts `Today at 10:00 AM: …`.
  - Ann's (creator) copies of both: same text with no `Can't make it?` line and no `/w/`.
  - Only Ann active: text contains `Who's in: Ann.` and no comma after it.
  - Venue `Joe & Co` in city `San Francisco`: Map line is `Map: https://maps.google.com/?q=Joe+%26+Co+San+Francisco`.
- [ ] **Step 6: Run** `npx vitest run src/email/templates.test.ts` — Expected: FAIL, `No email template for reminder_24h`.
- [ ] **Step 7: Implement** in `buildEmail`: for the two kinds, line 1 is `${Tomorrow|Today} at ${formatClock(gatheringAt)}: ${format} at ${venue}, ${city}.`, then the Map line (extract the existing `confirmed` map construction into one local helper used by both), blank, `Who's in: ${first names joined ', '}.`, blank, and the withdraw line plus trailing `''` only when `!commit.isCreator`. Subject is `${Tomorrow|Today}: ${format} at ${venue}, ${formatClock(gatheringAt)}`. Extend the guard at the top of the function to allow the two kinds. No change to the `confirmed` output.
- [ ] **Step 8: Run** `npx vitest run src/email src/domain/time.test.ts` — Expected: PASS, including the existing `confirmed` tests.
- [ ] **Step 9: Commit**

```bash
git add src/domain/time.ts src/domain/time.test.ts src/email/templates.ts src/email/templates.test.ts
git commit -m "feat: reminder email bodies (E3, E4)"
```

### Task 2: Reminder activities

**Covers:** AC7

**Files:**
- Modify: `src/temporal/activities.ts` (`REQUIRED_STATE` gets both reminder kinds → `'confirmed'`)
- Test: `src/temporal/activities.test.ts`

**Interfaces:**
- Consumes: `sendToCommitters(planId, kind)`, `sendToOne(planId, kind, commitId)`, `sendOnce` ledger keyed on (commit, kind).
- Produces: the same two activities now accepting `'reminder_24h' | 'reminder_morning'` (type `EmailKind` already includes them). Task 3's workflow calls them with these kinds.

- [ ] **Step 1: Write failing tests** in `src/temporal/activities.test.ts` (setup via the file's `setup()` helper; confirm the plan by committing up to the minimum):
  - `sendToCommitters(planId, 'reminder_24h')` on a confirmed plan with Ann, Mia, Raj sends 3 emails, each text containing `Who's in: Ann, Mia, Raj.`.
  - Called twice: still 3 emails total (ledger).
  - After Raj withdraws, `sendToCommitters(planId, 'reminder_morning')` sends 2 emails (Ann, Mia) and their text contains `Who's in: Ann, Mia.` and not `Raj`.
  - On a plan that is `open` (below minimum), `sendToCommitters(planId, 'reminder_24h')` sends nothing; on a `called_off` plan (after `resolveDeadline`) sends nothing.
  - `sendToOne(planId, 'reminder_morning', miaCommitId)` sends only to Mia.
  - Mia withdraws and rejoins, then `sendToCommitters(planId, 'reminder_24h')` twice around the rejoin: Mia has exactly one 24h reminder.
- [ ] **Step 2: Run** `npx vitest run src/temporal/activities.test.ts` — Expected: FAIL with `No activity support for reminder_24h`.
- [ ] **Step 3: Implement**: add `reminder_24h: 'confirmed'` and `reminder_morning: 'confirmed'` to `REQUIRED_STATE`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/temporal/activities.ts src/temporal/activities.test.ts
git commit -m "feat: reminders through the send activities"
```

### Task 3: Reminder timers in the plan workflow

**Covers:** AC1, AC3, AC4, AC5, AC6, AC7, AC8

**Files:**
- Modify: `src/temporal/workflows.ts` (replace the placeholder wait inside the `confirmed-emails-3-2` block)
- Modify: `tests/workflow/plan-workflow.test.ts` (add a `describe('planWorkflow reminders', …)` and a send-time recording wrapper)

**Interfaces:**
- Consumes: `activities.sendToCommitters(planId, kind)`, `activities.sendToOne(planId, 'confirmed', commitId)`, `PlanWorkflowInput` (`reminder24At`, `reminderMorningAt: number | null`, `checkInAt`, all epoch ms), `computeSchedule` and `Schedule` from `src/domain/plan-rules.ts` (ISO strings), Task 1–2 behaviour.
- Produces: `planWorkflow` behaviour: after the `confirmed` emails, if `reminder24At > Date.now()`: wait until it, send `reminder_24h`, record `sent24At = Date.now()`; then if `reminderMorningAt !== null` and `reminderMorningAt > Date.now()` and not (`sent24At !== null && reminderMorningAt - sent24At < 6 * 3_600_000`): wait until it, send `reminder_morning`; then wait until `checkInAt` (placeholder end for Epic 4). Every wait also drains `committed` signals with `sendToOne('confirmed', id)`. Gated by `patched('reminders-3-3')` so histories recorded by story 3.2's workflow replay.

**Test helpers to add in `tests/workflow/plan-workflow.test.ts`:**
- `runSchedule(deps, planId, { schedule: Schedule, confirmAt: string, sendEmail?, act? })`: like `run`, but `shift = (await env.currentTimeMs()) - Date.parse(confirmAt)` and every `PlanWorkflowInput` field is `Date.parse(schedule.X) + shift`; signals `confirmed` right after start; `act(handle, shift)` runs after that signal and may call `await env.sleep(ms)` to move time (time only skips inside `env.sleep` and `handle.result()`).
- `timedEmail(deps)`: a `sendEmail` wrapper that records `{ to, subject, at: await env.currentTimeMs() }` for each call and delegates to `deps.fakes.email.send`; an optional `failUntil` (absolute env ms) makes it throw `Error('email send failed')` while `env.currentTimeMs() < failUntil`.
- `EXAMPLE`: the example plan's schedule as ISO literals: `{ deadlineAt: '2026-11-12T06:00:00Z', reminder24At: '2026-11-13T18:00:00Z', reminderMorningAt: '2026-11-14T16:00:00Z', checkInAt: '2026-11-14T18:01:00Z' }` (these are the `plan-rules.test.ts` values; `checkInAt` only needs to be after the morning).
- Example plan setup: `confirmedPlan()` from the file (Ann, Mia, Raj, minimum 3). Expected sends are asserted as `Date.parse('<ISO literal>') + shift`, within 2000 ms.

- [ ] **Step 1: Write failing test — AC1 and AC2 through the workflow.** `runSchedule` with `EXAMPLE`, `confirmAt: '2026-11-12T18:00:00Z'`. Assert: 3 `confirmed` emails first; then 3 emails with subject `Tomorrow: Coffee at Blue Bottle, 10:00 AM` sent at `2026-11-13T18:00:00Z`+shift, to ann/mia/raj; then 3 with `Today: Coffee at Blue Bottle, 10:00 AM` at `2026-11-14T16:00:00Z`+shift; 9 emails total.
- [ ] **Step 2: Run** `npx vitest run tests/workflow/plan-workflow.test.ts -t "reminders"` — Expected: FAIL (6 emails sent instead of 9, no reminders).
- [ ] **Step 3: Implement the reminder timers in `planWorkflow`.** Add a local `async function waitUntil(at: number)` that loops `condition(() => lateCommitIds.length > 0, Math.max(at - Date.now(), 0))` and sends `sendToOne(planId, 'confirmed', lateCommitIds.shift()!)` per wake, returning when the condition times out; drain queued ids once before returning if `at` has passed. Replace the placeholder loop with the sequence from the Interfaces block, using a second `proxyActivities<Activities>` with `scheduleToCloseTimeout: '20h'` (other options as the first) for the two reminder sends (Ruling 2). Wrap in `patched('reminders-3-3')`; the else branch keeps the old placeholder loop verbatim.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Write failing test — AC3.** Plan for 09:30 on 2026-11-14 (`publishPlan(deps, { time: '09:30', minimum: '3' })`, then two commits), `schedule` from `computeSchedule` of its stored `gatheringAt` (assert via ISO literals that `reminderMorningAt` is `null`). Assert exactly one reminder email per committer (subject starts `Tomorrow:`) and none starting `Today:`.
- [ ] **Step 6: Write failing test — AC4.** `EXAMPLE` with `deadlineAt: '2026-11-14T14:00:00Z'`, `confirmAt: '2026-11-14T04:00:00Z'` (Fri 13 Nov 8:00 PM). Assert no `Tomorrow:` email and three `Today:` emails at `2026-11-14T16:00:00Z`+shift.
- [ ] **Step 7: Write failing test — AC5.** `EXAMPLE`, `confirmAt: '2026-11-12T18:00:00Z'`; in `act`: `await env.sleep(Date.parse('2026-11-13T18:00:00Z') - Date.parse('2026-11-12T18:00:00Z') + 60_000)`, `waitForEmails` until the three `Tomorrow:` emails exist, then Lee commits through `commit(...)` and `h.signal(committed, lee.commitId)`. Assert Lee has exactly two emails: a subject starting `It's on:` and one starting `Today:`; none starting `Tomorrow:`.
- [ ] **Step 8: Write failing test — AC6.** `EXAMPLE`, `confirmAt: '2026-11-12T18:00:00Z'`, `sendEmail` from `timedEmail` with `failUntil = Date.parse('2026-11-14T11:00:00Z') + shift` (Sat 3:00 AM PST) applied only to emails whose subject starts `Tomorrow:` (the confirmed email must go out first, unfailed). Assert the three `Tomorrow:` emails are recorded at or after that time, no `Today:` email exists, and the workflow completes.
- [ ] **Step 9: Write failing test — AC7.** `EXAMPLE`; in `act`: `env.sleep` past the 24h reminder, `waitForEmails` for the three `Tomorrow:` emails, then withdraw Raj (`withdraw(deps, rajToken)`). Assert exactly two `Today:` emails (Ann, Mia), neither containing `Raj`, and Raj got no `Today:` email.
- [ ] **Step 10: Write failing test — AC8 (DST).** Plan for `2026-11-01` 10:00 (`publishPlan(deps, { date: '2026-11-01', time: '10:00', minimum: '3' })` plus two commits; the example date in `planForm` stays 2026-11-14 elsewhere), `schedule` from `computeSchedule`, `confirmAt: '2026-10-30T18:00:00Z'`. Assert `Tomorrow:` emails at `2026-10-31T18:00:00Z`+shift and `Today:` at `2026-11-01T16:00:00Z`+shift. Add the same for 2027-03-14 10:00 (gathering on spring-forward day): `Tomorrow:` at `2027-03-13T18:00:00Z`, `Today:` at `2027-03-14T16:00:00Z`, `confirmAt: '2027-03-12T18:00:00Z'`.
- [ ] **Step 11: Run** the workflow test file — Expected: steps 5–10's tests that the Step 3 implementation already satisfies pass on first run; show each is capable of failing with these mutations, then revert each: (a) drop the `reminderMorningAt > Date.now()` check → AC4 fails; (b) drop the 6h rule → AC6 fails; (c) use `sendToCommitters` for `Today:` with a stale recipient list captured before the wait → AC7 fails; (d) call `reminder_24h` without the `reminder24At > Date.now()` guard → AC4 fails. Fix the implementation for any test that fails for real. Remember the 6h rule is the only code AC6 needs: if it is still missing after Step 3, implement it now (`sent24At` recorded from `Date.now()` right after the 24h activity returns).
- [ ] **Step 12: Write a replay test** `it('replays a history recorded before the reminders patch')`: run the workflow to completion with the current code, then `Worker.runReplayHistory` on a history recorded from the 3.2 workflow shape. Record that history by running the 3.2-era `planWorkflow` (git `2fc774d:src/temporal/workflows.ts`) once and saving the JSON under `tests/fixtures/workflow/confirmed-3-2.json`; replay it against the current `workflows.ts` and expect no `DeterminismViolationError`.
- [ ] **Step 13: Run** `npx vitest run` and `npx tsc --noEmit` — Expected: both pass; the existing 3.1/3.2 workflow tests (which use `reminderMorningAt: null` and `reminder24At: now + 2h`) still pass. If a 3.2 test now sees reminder emails (e.g. `toHaveLength(3)` after `run()` with `reminder24At: now + 7_200_000` before `checkInAt`), change that test's input in `run()` to put `reminder24At` in the past (`now - 1`) so it keeps asserting only the confirmation behaviour.
- [ ] **Step 14: Commit**

```bash
git add src/temporal/workflows.ts tests/workflow/plan-workflow.test.ts tests/fixtures/workflow
git commit -m "feat: 24h and morning reminders in the plan workflow"
```

## Self-review

- **AC1** → Task 3 steps 1–4 (subjects and instants; subject text in Task 1). **AC2** → Task 1 step 5 (exact bodies, Ann's copies) and Task 3 step 1. **AC3** → Task 3 step 5. **AC4** → step 6. **AC5** → step 7. **AC6** → step 8. **AC7** → Task 2 (recipient list from active commits) and Task 3 step 9. **AC8** → step 10 (the literals themselves are pinned in `plan-rules.test.ts`).
- Types: `EmailKind` members `reminder_24h` / `reminder_morning` are used identically in Tasks 1–3; `formatClock` is defined in Task 1 and used only there.
