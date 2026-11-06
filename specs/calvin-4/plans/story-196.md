# Confirmation emails (story 3.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send the `confirmed` email (frame E1) to every active committer when a plan is confirmed, and to a late committer straight away, each at most once.

**Architecture:** `planWorkflow` gains a confirmed phase: after the `confirmed` signal or a `resolveDeadline` that returns `confirmed`, it calls `sendToCommitters('confirmed')`, then waits on a `committed(commitId)` signal queue and calls a new `sendToOne` activity per id. Activities re-read Postgres and send through `sendOnce`, whose ledger (`commit`, `kind`) gives the at-most-once guarantee. The email body is built in `buildEmail`.

**Tech Stack:** TypeScript on Node 26, Temporal (`@temporalio/workflow`, time-skipping test env), Drizzle/Postgres, vitest.

**Spec:** .factory/story.md (story #196)

## Global Constraints

- Workflow code imports only `@temporalio/workflow` and types, gets its schedule as epoch milliseconds, and uses neither `Intl` nor JS `Temporal` — workflow code must replay deterministically. ([ADR 0001](docs/adr/0001-temporal-workflow-per-plan.md))
- Every activity re-reads Postgres and acts only if the plan's state still matches (no reminder unless `confirmed`, no `not_this_time` unless `called_off`, nothing to withdrawn committers) — signals are hints, not state. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Every email is sent through `sendOnce`, with its payload built only from stored data — that's what makes each email go out exactly once and a retry identical. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md), [ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Plan and commit state changes only in `src/domain/plans.ts`, inside a transaction that locks the plan row and appends its event through `appendEvent` — one source of truth, and commit races settle on the row lock. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Times are stored as UTC `timestamptz`, and every local-time rule and display format goes through `src/domain/time.ts` with `PLAN_TIME_ZONE` — one place for DST and the UX §8.8 formats.
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Use Temporal's `patched()` / `deprecatePatch()` for any change to `planWorkflow` once plans are live, with a replay test against a recorded history; don't hand-roll version flags — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use `@temporalio/testing`'s `TestWorkflowEnvironment.createTimeSkipping()` to test the plan workflow's timers; don't fake clocks or mock `sleep` — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Resend's tags (`{ name: "kind", value: <kind> }`) to mark each email's kind — [finding](specs/calvin/research/resend.md).
- A Temporal signal or start failure after a committed transaction is logged at `error` and never fails the user's request — the commit already stands. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities. ([ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Test isolation: ports derive from `FACTORY_PORT_BASE` (Postgres on `FACTORY_PORT_BASE + 2`, default 20002) and the test database is `FACTORY_DB_NAME` (default `calvin_test`); never hard-code either, and `TEST_DATABASE_URL` is built only in `vitest.config.ts`. (`specs/calvin-4/test-strategy.md`)
- Email kinds are a snake_case string union; signals are camelCase (`confirmed`, `committed`, `calledOff`). (`specs/calvin-4/architecture.md`)
- Tests: TDD for every task (poc): a failing test first, then the code.

Binding: CODING_STANDARDS.md, GLOSSARY.md, docs/adr/0001-temporal-workflow-per-plan.md, docs/adr/0002-postgres-owns-state-temporal-owns-time.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md, specs/calvin-4/test-strategy.md, specs/calvin-4/architecture.md

## Review Focus

- A `committed` signal for a commit that withdrew before the activity runs: no email (activity checks `withdrawn_at`).
- A `committed` signal for a plan that is not (or no longer) `confirmed`, e.g. called off: no email (state check).
- A `committed` signal that arrives during the open phase: harmless; it must not send early, and the later confirmed fan-out still reaches that committer once.
- A venue or city with spaces or `&` in the Map URL: encoded as `+` / `%26`, so the link isn't broken.
- A plan whose only committer is the creator (minimum 1): the spec gives no grammar for one name; the list is just the names, so the test pins `It's on. Ana are in.` with no stray comma.

## Existing code this builds on

- `src/temporal/workflows.ts`: open phase only; signals `confirmed`, `calledOff`; no `committed`, and a deadline that resolves to `confirmed` does nothing.
- `src/temporal/activities.ts`: `sendToCommitters(planId, kind)` with `REQUIRED_STATE` (only `not_this_time`).
- `src/email/templates.ts`: `buildEmail(kind, plan, commit, baseUrl)` supports `manage_link`, `not_this_time`.
- `src/email/send.ts`: `sendOnce(deps, kind, plan, commit)`; `kind='confirmed'` is already in the schema's enum, no migration.
- `src/web/routes/public.ts` already signals `confirmed` / `committed` (commitId) after a commit; no web change.
- `src/web/views/public-plan-page.ts` exports `firstName(fullName)`; the email lists committers by first name the same way (reuse it, don't copy it).
- Test helpers: `tests/support/builders.ts` (`publishPlan`, `testDeps`, `TEST_BASE_URL`), fakes in `tests/support/fakes.ts` (`fakeEmail` has `calls`, `attempts`, `failNext()`; `fakePlanWorkflows` has `signalCalls`).

### Task 1: The confirmation email (frame E1)

**Covers:** AC1, AC2

**Files:**
- Modify: `src/email/templates.ts`
- Modify: `src/email/send.ts` (pass the active committers through)
- Test: `src/email/templates.test.ts`

**Interfaces:**
- Consumes: `CommitRow`, `PlanRow` from `src/domain/plans.ts`; `formatWhen`, `formatShareWhen` from `src/domain/time.ts`; `firstName` from `src/web/views/public-plan-page.ts`.
- Produces: `buildEmail(kind: EmailKind, plan: PlanRow, commit: CommitRow, baseUrl: string, activeCommits: CommitRow[] = []): EmailPayload`, with `'confirmed'` supported; `sendOnce(deps, kind, plan, commit, activeCommits: CommitRow[] = [])` forwards `activeCommits` to `buildEmail`.

- [ ] **Step 1: Write the failing tests** in `src/email/templates.test.ts` (reuse its `plan`/`commit()` helpers; set `plan.state: 'confirmed'`, `city: 'Oakland'`, `gatheringAt` `2026-11-14T18:00:00Z`; build `active` as three commits named Ana (creator), Mia, Raj in that order):
  - `confirmed subject`: `payload.subject` is `It's on: Coffee at Blue Bottle, Sat 14 Nov 10:00 AM`; `payload.to` is the commit's email; `payload.tags` equals `[{ name: 'kind', value: 'confirmed' }]`.
  - `confirmed body for a joiner`: `payload.text` equals exactly
    `"It's on. Ana, Mia, Raj are in.\n\nCoffee at Blue Bottle\nSat 14 Nov · 10:00 AM\nMap: https://maps.google.com/?q=Blue+Bottle+Oakland\n\nWe'll remind you the day before and that morning.\n\nCan't make it? Withdraw: https://example.test/w/<that commit's withdrawToken>\n"`.
  - `confirmed body for the creator`: same text without the last two lines (blank line and the `Can't make it?` line); assert `not.toContain("Can't make it")` and `not.toContain('/w/')`.
  - `map link encoding`: venue `Tom & Jerry's`, city `San José` gives a `Map:` URL equal to `https://maps.google.com/?q=` + `new URLSearchParams({ q: "Tom & Jerry's San José" }).toString().slice(2)` (spaces as `+`, `&` as `%26`).
  - `one name`: with `active` of only the creator, the first line is `It's on. Ana are in.`
- [ ] **Step 2: Run** `npx vitest run src/email/templates.test.ts` — Expected: FAIL with "No email template for confirmed".
- [ ] **Step 3: Implement** the `confirmed` branch in `buildEmail`, plus the `activeCommits` parameter in `buildEmail` and `sendOnce`. Names are `firstName(c.name)` in the order given (the loader orders by `createdAt`, creator first); the Map URL is built with `URLSearchParams({ q: `${plan.venue} ${plan.city}` })`; the withdraw line (`Can't make it? Withdraw: ${baseUrl}/w/${commit.withdrawToken}`) is omitted when `commit.isCreator`; the text ends with a single `\n`.
- [ ] **Step 4: Run** the same command — Expected: PASS, and `npx vitest run src/email` still passes.
- [ ] **Step 5: Commit**
```bash
git add src/email/templates.ts src/email/send.ts src/email/templates.test.ts
git commit -m "feat: confirmed email template (E1)"
```

### Task 2: Activities that send `confirmed`

**Covers:** AC1, AC3, AC6, AC7

**Files:**
- Modify: `src/domain/plans.ts` (add a loader; read-only query, no state change)
- Modify: `src/temporal/activities.ts`
- Test: `src/temporal/activities.test.ts`

**Interfaces:**
- Consumes: `buildEmail`/`sendOnce` from Task 1; `loadSendTargets(db, planId): Promise<{ plan; commits }>` (active commits, creator first).
- Produces: `REQUIRED_STATE.confirmed = 'confirmed'`; `sendToCommitters(planId, 'confirmed')` passes the active commits to `sendOnce`; new activity `sendToOne(planId: string, kind: EmailKind, commitId: string): Promise<void>`, which re-reads the plan and active commits, returns without sending when the plan's state isn't the kind's required state or `commitId` isn't among the active commits, and otherwise calls `sendOnce`.

- [ ] **Step 1: Write the failing tests** in `src/temporal/activities.test.ts` (follow its existing setup; use `publishPlan`, `commit`, `withdraw` and the fake email):
  - `sendToCommitters confirmed sends one email per active committer`: plan confirmed with Ann, Mia, Raj; two calls to `sendToCommitters(planId, 'confirmed')` leave `deps.fakes.email.calls` at 3, each subject `It's on: Coffee at Blue Bottle, Sat 14 Nov 10:00 AM`; Mia's text contains `https://calvin.test/w/${miaToken}`, Ann's contains no `/w/` (AC1, AC3 dedupe).
  - `sendToCommitters confirmed skips a committer who withdrew before confirmation`: Raj withdraws while the plan is open (minimum 4), Lee commits to confirm; the three recipients exclude Raj and the body's first line omits Raj (AC6).
  - `sendToCommitters confirmed sends nothing while the plan is open or called off`: 0 calls for each state.
  - `sendToOne sends only to the named active committer`: confirmed plan, `sendToOne(planId, 'confirmed', leeCommitId)` sends one email to Lee, Lee's body names all active committers; called again, still one (AC3).
  - `sendToOne ignores a withdrawn committer and a non-confirmed plan`: 0 calls.
  - `a rejoined committer is not emailed again`: Mia is sent `confirmed`, withdraws, rejoins (`commit` again), then `sendToOne(planId, 'confirmed', miaCommitId)` adds no call (AC7).
- [ ] **Step 2: Run** `npx vitest run src/temporal/activities.test.ts` — Expected: FAIL ("No activity support for confirmed" / `sendToOne` undefined).
- [ ] **Step 3: Implement** `sendToOne` and the `confirmed` entry in `REQUIRED_STATE` in `src/temporal/activities.ts`; `sendToCommitters` passes `commits` as the `activeCommits` argument. No new loader is needed unless `loadSendTargets` is awkward; if one is added to `plans.ts`, it is a read-only query.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add src/temporal/activities.ts src/domain/plans.ts src/temporal/activities.test.ts
git commit -m "feat: activities send the confirmed email once"
```

### Task 3: The workflow's confirmed phase

**Covers:** AC1, AC3, AC4, AC5, AC6, AC7

**Files:**
- Modify: `src/temporal/workflows.ts`
- Test: `tests/workflow/plan-workflow.test.ts`

**Interfaces:**
- Consumes: activities `resolveDeadline`, `sendToCommitters(planId, 'confirmed')`, `sendToOne(planId, 'confirmed', commitId)` from Task 2.
- Produces: exported signal `committed = defineSignal<[string]>('committed')` (payload is the commit id; the web route already sends it). After the open phase, if the plan is confirmed (signal or `resolveDeadline` result `'confirmed'`) the workflow sends `confirmed` to all, then drains `committed` ids through `sendToOne` until `input.checkInAt`, then returns. Reminders and check-in are story 3.3 and later; this wait is the placeholder end of the confirmed phase.

- [ ] **Step 1: Write the failing tests** in `tests/workflow/plan-workflow.test.ts`. Extend `run` to take an optional `act(handle)` callback that runs with the started handle (start the workflow with `env.client.workflow.start`, call `act`, then `await handle.result()` inside `worker.runUntil`), and a `signals` need: `handle.signal(confirmed)` / `handle.signal(committed, id)` import the signal definitions from `workflows.ts`. Use the time-skipping env; the deadline is 1h out and `checkInAt` 3h out in the existing helper.
  - `sends the confirmed email to everyone when the confirmed signal arrives` (AC1): plan confirmed through `commit` with Ann, Mia, Raj; signal `confirmed`; 3 emails, Mia's text equals the E1 body with her withdraw link and Ann's has none.
  - `sends it twice-signalled confirmed once each` (AC5): signal `confirmed` twice; still 3 calls.
  - `a late commit gets the email straight away and nobody else a second one` (AC3): after `confirmed`, `commit` Lee, signal `committed` with Lee's commit id; 4 calls, Lee's to `lee@example.test`, only one per address.
  - `a confirmed plan whose signal failed is confirmed at the deadline` (AC4): plan confirmed by `commit` (minimum 3, Mia and Raj), no signal; workflow runs to the deadline; 3 `confirmed` emails are sent and the state stays `confirmed`. (Replaces the open-phase test that expects 0 calls: update `leaves a plan that reached its minimum confirmed when the confirmed signal never arrived` to expect 3 `confirmed` emails.)
  - `a committer who withdrew before confirmation gets nothing` (AC6): Raj withdraws while open; confirmation sends to the rest only.
  - `a rejoin signalled after confirmation sends nothing new` (AC7): everyone gets E1, Mia withdraws and rejoins, signal `committed` with her id; call count unchanged.
- [ ] **Step 2: Run** `npx vitest run tests/workflow/plan-workflow.test.ts` — Expected: FAIL (no confirmed emails sent; `committed` not exported).
- [ ] **Step 3: Implement** in `planWorkflow`: add the `committed` signal whose handler pushes ids onto a local queue; when `isConfirmed` or the deadline resolves to `'confirmed'`, call `sendToCommitters(input.planId, 'confirmed')`, then loop `await condition(() => queue.length > 0, Math.max(input.checkInAt - Date.now(), 0))`, shifting ids into `sendToOne` until the condition times out. Wrap the new confirmed phase in `patched('confirmed-emails-3-2')` so any history recorded by the open-phase-only workflow replays unchanged. A `calledOff` signal during the confirmed phase is story 3.5, not handled here. Workflow code imports only `@temporalio/workflow` and types.
- [ ] **Step 4: Run** `npx vitest run tests/workflow/plan-workflow.test.ts` then the full suite `npx vitest run` and `npx tsc --noEmit` — Expected: all PASS.
- [ ] **Step 5: Commit**
```bash
git add src/temporal/workflows.ts tests/workflow/plan-workflow.test.ts
git commit -m "feat: workflow sends confirmed emails and handles late commits"
```

## Rulings

Ruling: committers in the E1 "are in" line are listed by first name in commit order (creator first), not alphabetically — the spec's example is both orders at once and the public seats use first names in commit order — if wrong, only the order in one sentence changes.
Ruling: the placeholder wait after the confirmed fan-out runs until `checkInAt` — the input carries no gathering time and 3.3 adds the real timers — if wrong, 3.3 replaces one `condition` call.
Ruling: the new phase is gated with `patched()` but no recorded-history replay test is added — the workflow has had one story's lifetime and poc has no live plans — if wrong, a live open-phase history could fail to replay until a replay test is written.
Ruling: no web change — `src/web/routes/public.ts` already sends `confirmed` and `committed(commitId)` signals and logs failures — if a signal fails, the deadline path (AC4) covers the confirmation.
