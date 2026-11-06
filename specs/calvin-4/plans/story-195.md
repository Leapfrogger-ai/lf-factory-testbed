# Story 3.1: Call off a plan that misses its minimum — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `planWorkflow` waits for the commit deadline, calls off a plan that is still below its minimum, and sends every active committer one quiet "not this time" email; the called-off pages match frames P1, P2 and W1.

**Architecture:** The workflow only keeps time (ADR 0001/0002): an open phase `condition(() => confirmed || calledOff, deadline − now)`, then the `resolveDeadline` activity, which calls `resolveDeadline` in `src/domain/plans.ts` (row lock, conditional `open → called_off`, event). On `called_off` the workflow runs the `sendToCommitters` activity, which re-reads Postgres and sends through `sendOnce`. Email text moves into `src/email/templates.ts` (one function per kind) so the new kind has a home.

**Tech Stack:** TypeScript on Node 26 (type stripping), Temporal TS SDK 1.24.0 (`@temporalio/workflow`, `@temporalio/worker`, `@temporalio/testing` time-skipping), Drizzle + Postgres 17 (embedded for tests), Hono + `hono/html`, Vitest 5.

**Spec:** .factory/story.md (story #195)

## Global Constraints

- Use Temporal's durable timers (`sleep`, `condition(fn, timeout)`) for waiting until the commit deadline, reminders and check-in; don't hand-roll a cron job, a due-items table or `setTimeout` — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Temporal's activity retry policy and timeouts (`proxyActivities`, `retry`, `startToCloseTimeout`, `scheduleToCloseTimeout`) for retrying Postgres and Resend calls; don't hand-roll retry loops or backoff — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use `@temporalio/testing`'s `TestWorkflowEnvironment.createTimeSkipping()` to test the plan workflow's timers; don't fake clocks or mock `sleep` — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Temporal's `patched()` / `deprecatePatch()` for any change to `planWorkflow` once plans are live, with a replay test against a recorded history; don't hand-roll version flags — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Drizzle's `db.transaction` and `.for('update')` for commit, confirm, call-off and deadline resolution; don't add application locks — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine — [finding](specs/calvin/research/node-hono-drizzle.md).
- Plan and commit state changes only in `src/domain/plans.ts`, inside a transaction that locks the plan row and appends its event through `appendEvent` — one source of truth, and commit races settle on the row lock. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Workflow code imports only `@temporalio/workflow` and types, gets its schedule as epoch milliseconds, and uses neither `Intl` nor JS `Temporal` — workflow code must replay deterministically. ([ADR 0001](docs/adr/0001-temporal-workflow-per-plan.md))
- Every activity re-reads Postgres and acts only if the plan's state still matches (no reminder unless `confirmed`, no `not_this_time` unless `called_off`, nothing to withdrawn committers) — signals are hints, not state. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Every email is sent through `sendOnce`, with its payload built only from stored data — that's what makes each email go out exactly once and a retry identical. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md), [ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address — SQL and I/O stay in one module, and NFR006 holds by construction.
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed in. ([test-strategy](specs/calvin/test-strategy.md))
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities. ([ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
4. Activity options: `startToCloseTimeout: "30s"`, `scheduleToCloseTimeout: "12h"` (well inside Resend's 24h key window), `retry: { initialInterval: "5s", backoffCoefficient: 2, maximumInterval: "10m" }`.
5. Workflow code imports only `@temporalio/workflow` and types. Compute the schedule outside the workflow and pass it in as epoch milliseconds; don't use `Intl` or JS `Temporal` inside the workflow. Waits are `instant − Date.now()` (deterministic inside workflows), floored at 0.
2. Treat signals as hints. Every activity re-reads Postgres. `sendToCommitters` sends only to commits with `withdrawn_at IS NULL`, and only if the plan's state still matches the email (no reminder unless `confirmed`; no `not_this_time` unless `called_off`).
- `createActivities(deps)` in `src/temporal/activities.ts` gets `{ db, sendEmail }`.
- Plan workflow tests sit in `tests/workflow/*.test.ts`. Shared test helpers sit in `tests/support/`, recorded responses in `tests/fixtures/`.
- Tests can only replace a boundary that the code receives as an argument, so the code is wired like this. Reviewers check it:
- `fileParallelism: false` makes test files run one after another. The time-skipping server's clock is global, so workflow tests must run serially anyway (research/temporal-typescript-sdk.md). Each integration file resets the database before each test.
| Test database | `FACTORY_DB_NAME` on that server (default `calvin_test`) |
| Temporal time-skipping test server | `FACTORY_PORT_BASE + 1` (default: a free port chosen by the SDK) |
`TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database.
- Maturity: **poc**. Terms are the ones in `GLOSSARY.md`.

Binding: CODING_STANDARDS.md, GLOSSARY.md, docs/adr/0001-temporal-workflow-per-plan.md, docs/adr/0002-postgres-owns-state-temporal-owns-time.md, specs/calvin-4/test-strategy.md, specs/calvin-4/architecture.md

## Review Focus

- The creator is the only committer (count 1, below the minimum) → called off; the creator gets "not this time" with no withdraw link (Task 1 and Task 2 tests).
- `resolveDeadline` runs on a plan that is already called off (a retried activity, or the creator's call-off in story 3.5) → it returns `called_off` and appends no second `plan.called_off` event (Task 2 test).
- The deadline is already in the past when the workflow starts (wait floored at 0) → the plan is still resolved, not stuck (Task 4 test).
- The activity runs twice (retry, or worker restart) → still one email and one `email.sent` event per committer (Task 3 and Task 4 tests).
- A commit or withdraw link opened on a called-off plan shows no form, no button and never stores anything (Task 5 tests).

## Rulings

Ruling: `createActivities` takes `{ db, sendEmail, baseUrl }`, not just `{ db, sendEmail }` — `sendOnce` already requires `baseUrl` and the withdraw/manage links in later stories need it; `src/main.ts` passes `config.baseUrl` — costs one more field on the factory if wrong.
Ruling: `resolveDeadline` takes `(db, planId)` and stamps `called_off_at` with SQL `now()`, no `deps.now` — activities have no clock in `{ db, sendEmail }`, and Temporal's skipped time must not leak into stored timestamps; `Date.now()`/`new Date()` are forbidden outside `main.ts` — costs a slightly different clock source than routes use.
Ruling: the "Can't make it? Withdraw" link is left out of "not this time", following AC2 and PRD FR016 (operator, #191), although the E2 frame in `specs/calvin-4/ux/epic-3.html` still draws it — the story and PRD are newer than that frame; costs nothing if wrong beyond re-adding one line.
Ruling: the new-look restyle (wordmark, serif title, button sizing) belongs to story 3.7; this story changes only content and classes frames P1, P2 and W1 need (`state-off` pill, notice above the pill) — keeps the story small; costs a later restyle touching the same views.
Ruling: `src/temporal/workflows.ts` is added to the `Date.now()` allow-list in `tests/guardrails-source.test.ts` — the architecture requires `instant − Date.now()` inside workflows, where it is deterministic; costs a one-file exception.

---

### Task 1: "Not this time" email template

**Covers:** AC2

**Files:**
- Create: `src/email/templates.ts`, `src/email/templates.test.ts`
- Modify: `src/email/send.ts` (replace `buildPayload` with `buildEmail`), `src/email/send.test.ts`

**Interfaces:**
- Consumes: `PlanRow`, `CommitRow` from `src/domain/plans.ts`; `formatDay` from `src/domain/time.ts`; `EmailPayload` from `src/email/send-email.ts`; `EmailKind` from `src/email/send.ts` (move the type to `templates.ts` and re-export it from `send.ts`).
- Produces: `buildEmail(kind: EmailKind, plan: PlanRow, commit: CommitRow, baseUrl: string): EmailPayload` — `manage_link` behaves exactly as today; `not_this_time` as below; any other kind throws `No email template for <kind>`.

- [ ] **Step 1: Write the failing test** in `src/email/templates.test.ts` (unit, no database; build `PlanRow`/`CommitRow` literals with `@example.test` addresses, venue `Blue Bottle`, format `coffee`, `gatheringAt` `2026-11-14T18:00:00Z`).
  - `not_this_time` payload: `subject` equals `"Not this time: Coffee on Sat 14 Nov"`; `text` contains `"This one didn't come together, and that's fine. Nobody's going, so there's nothing to do."`; `to` is the commit's email; `tags` is `[{ name: 'kind', value: 'not_this_time' }]`.
  - For a creator commit and a non-creator commit: `text` does not contain `/w/` or the withdraw token, does not contain the commit's `name`, and does not match `/\d/` (no count; the sentence has no digits).
  - `buildEmail('confirmed', …)` throws `No email template for confirmed`.
- [ ] **Step 2: Run** `npx vitest run src/email/templates.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement `buildEmail` in `src/email/templates.ts`** by moving the `manage_link` body out of `send.ts` unchanged and adding the `not_this_time` case (subject `Not this time: <Format> on <formatDay>`, text = the sentence plus a trailing newline). `sendOnce` calls `buildEmail`.
- [ ] **Step 4: Run** `npx vitest run src/email` — Expected: PASS, including the existing `send.test.ts` (the manage_link text is unchanged).
- [ ] **Step 5: Commit**

```bash
git add src/email
git commit -m "feat: not_this_time email template"
```

### Task 2: `resolveDeadline` in plan operations

**Covers:** AC1, AC4

**Files:**
- Modify: `src/domain/plans.ts`, `src/domain/plans.test.ts`

**Interfaces:**
- Consumes: `appendEvent` (`plan.called_off` with `{ reason, wasConfirmed, activeCount }`), `plans`/`commits` tables.
- Produces: `resolveDeadline(db: Db, planId: string): Promise<{ state: PlanRow['state'] }>` and `loadSendTargets(db: Db, planId: string): Promise<{ plan: PlanRow; commits: CommitRow[] }>` (the plan, and its active commits only, oldest first; throws `No plan for that id` when missing).

- [ ] **Step 1: Write the failing tests** in `plans.test.ts` (Plan operations seam; setup through `publishPlan`, `commit`, `withdraw`; read back through `loadPlan`, never SQL). Use the example plan: `planForm()` (minimum 3, Coffee at Blue Bottle, Sat 14 Nov).
  - `resolveDeadline: an open plan below its minimum is called off`: Ann + one committer (count 2) → returns `{ state: 'called_off' }`; `loadPlan(...).state` is `'called_off'`; its `events` contain `{ type: 'plan.called_off', data: { reason: 'deadline', wasConfirmed: false, activeCount: 2 } }`.
  - `resolveDeadline: a plan that reached its minimum stays confirmed` (AC4): three commits through `commit()` confirm it; `resolveDeadline` returns `{ state: 'confirmed' }`, no `plan.called_off` event.
  - `resolveDeadline: counts only active commits`: three commits, one withdrawn → called off with `activeCount: 2`.
  - `resolveDeadline: a creator-only plan is called off with activeCount 1`.
  - `resolveDeadline: a second call leaves the called-off plan alone`: after the first call, a second returns `{ state: 'called_off' }` and `events` holds exactly one `plan.called_off` (creator call-off is story 3.5; the same early return covers it).
  - `loadSendTargets` returns only non-withdrawn commits, creator first.
- [ ] **Step 2: Run** `npx vitest run src/domain/plans.test.ts` — Expected: FAIL (`resolveDeadline` is not exported).
- [ ] **Step 3: Implement `resolveDeadline`** in `plans.ts`: in one `db.transaction`, select the plan `.for('update')`; when `state === 'open'` count active commits and, if below `minimum`, update to `called_off` with `calledOffAt: sql\`now()\`` and `calledOffReason: 'deadline'`, then `appendEvent` `plan.called_off` (`wasConfirmed: false`). Return the plan's resulting state. Do not compare against a clock (Ruling above). Implement `loadSendTargets` beside `loadSendTarget`.
- [ ] **Step 4: Run** `npx vitest run src/domain/plans.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/domain/plans.ts src/domain/plans.test.ts
git commit -m "feat: resolveDeadline calls off a plan below its minimum"
```

### Task 3: Activities

**Covers:** AC3, AC5

**Files:**
- Create: `src/temporal/activities.ts`, `src/temporal/activities.test.ts`

**Interfaces:**
- Consumes: `resolveDeadline`, `loadSendTargets` (Task 2); `sendOnce` (via `buildEmail`, Task 1); `EmailKind`; `Db`; `SendEmail`.
- Produces:

```ts
export type Activities = ReturnType<typeof createActivities>;
export function createActivities(deps: { db: Db; sendEmail: SendEmail; baseUrl: string }): {
  resolveDeadline(planId: string): Promise<'open' | 'confirmed' | 'called_off'>;
  sendToCommitters(planId: string, kind: EmailKind): Promise<void>;
};
```

- [ ] **Step 1: Write the failing tests** in `activities.test.ts` (integration; `resetDb` in `beforeEach`; setup through `testDeps`, `publishPlan`, `commit`, `withdraw`; assert on `deps.fakes.email.calls` and the `loadPlan` events).
  - `sendToCommitters not_this_time sends one email to each active committer of a called-off plan`: example plan, Ann + Mia, `resolveDeadline` first; two calls, subjects both `"Not this time: Coffee on Sat 14 Nov"`, recipients `ann@example.test` and `mia@example.test`.
  - `sends nothing to a committer who withdrew` (AC3): three commits, one withdrawn, deadline resolve needs count < 3 so it is called off; the withdrawn address gets no call.
  - `sends nothing while the plan is not called off`: plan still open, and a confirmed plan → zero calls.
  - `a retry after a failed first send still sends exactly one email each` (AC5): `fakes.email.failNext()`, first `sendToCommitters` call rejects; second resolves; `fakes.email.calls` has length 2 (one per committer, different recipients) and each committer has exactly one `email.sent` event in `loadPlan(...).events`.
  - `sendToCommitters is idempotent`: calling it twice after success leaves `calls.length` at 2.
  - `resolveDeadline returns the plan's real state`: `'called_off'` below the minimum, `'confirmed'` for a plan that confirmed through `commit()`.
- [ ] **Step 2: Run** `npx vitest run src/temporal/activities.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement `createActivities`**. `sendToCommitters` loads `loadSendTargets`, returns without sending unless the plan's state equals the state the kind requires (a `Record` keyed by kind; only `not_this_time → 'called_off'` for now, any other kind throws `No activity support for <kind>`), then awaits `sendOnce` for each active commit in order (a throw propagates so Temporal retries).
- [ ] **Step 4: Run** `npx vitest run src/temporal/activities.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/temporal/activities.ts src/temporal/activities.test.ts
git commit -m "feat: resolveDeadline and sendToCommitters activities"
```

### Task 4: `planWorkflow` open phase, worker and wiring

**Covers:** AC1, AC3, AC4, AC5

**Files:**
- Modify: `src/temporal/workflows.ts`, `src/temporal/worker.ts`, `src/main.ts`, `tests/guardrails-source.test.ts`
- Create: `tests/workflow/plan-workflow.test.ts`

**Interfaces:**
- Consumes: `Activities` (Task 3); existing `PlanWorkflowInput`.
- Produces: signals `confirmed` and `calledOff` (`defineSignal<[]>`, names exactly those) exported from `workflows.ts`; `startWorker(deps: { db: Db; sendEmail: SendEmail; baseUrl: string })` creating the worker with `activities: createActivities(deps)`; `planWorkflow(input)` with this behaviour — wait `condition(() => confirmed || calledOff, max(deadlineAt − Date.now(), 0))`; if neither signal arrived call `resolveDeadline(planId)`; if the state is `called_off` (from the activity or the `calledOff` signal) call `sendToCommitters(planId, 'not_this_time')` and end; otherwise end (confirmed phase is story 3.2). Activities are proxied with `startToCloseTimeout: '30s'`, `scheduleToCloseTimeout: '12h'`, `retry: { initialInterval: '5s', backoffCoefficient: 2, maximumInterval: '10m' }`, and `import type { Activities }` only.

- [ ] **Step 1: Write the failing workflow test** `tests/workflow/plan-workflow.test.ts`: one shared `TestWorkflowEnvironment.createTimeSkipping()` (`beforeAll`/`afterAll`), `resetDb` in `beforeEach`, a `Worker.create({ connection: env.nativeConnection, taskQueue, workflowsPath, activities: createActivities({ db, sendEmail: fakes.email.send, baseUrl: TEST_BASE_URL }) })` per test with a unique task queue, run with `worker.runUntil(env.client.workflow.execute(planWorkflow, { workflowId, taskQueue, args: [input] }))`. `input` is `{ planId, deadlineAt: await env.currentTimeMs() + 3_600_000, reminder24At/checkInAt: later values, reminderMorningAt: null }`. Tests:
  - `calls off a plan below its minimum at the deadline` (AC1): example plan with 2 commits; after the run `loadPlan` shows state `called_off` and a `plan.called_off` event `{ reason: 'deadline', wasConfirmed: false, activeCount: 2 }`; `fakes.email.calls` has 2 payloads, each with `subject` `"Not this time: Coffee on Sat 14 Nov"`, none with `/w/` in `text`.
  - `sends nothing to a committer who withdrew before the deadline` (AC3).
  - `leaves a plan that reached its minimum confirmed when the confirmed signal never arrived` (AC4): three commits through `commit()`; no signal sent; state stays `confirmed`, `fakes.email.calls` is empty.
  - `retries a failed first send and still sends one email each` (AC5): `fakes.email.failNext()` before the run; `fakes.email.attempts.length` is 3 and `calls.length` is 2.
  - `resolves a plan whose deadline is already past` (Review Focus): `deadlineAt` = `env.currentTimeMs() − 1000`; still called off, 2 emails.
- [ ] **Step 2: Run** `npx vitest run tests/workflow` — Expected: FAIL (workflow does nothing, so state stays `open` and no email is sent).
- [ ] **Step 3: Implement `planWorkflow`** as specified above in `workflows.ts`, keeping the `PlanWorkflowInput` type. Update `startWorker` to take deps and pass `activities`; update `src/main.ts` to call `startWorker({ db, sendEmail, baseUrl: config.baseUrl })` with the same `sendEmail` it gives the app (build it once). Add `'src/temporal/workflows.ts'` to the allow-list of the `Date.now()` guardrail test, with a comment that workflow time is deterministic.
- [ ] **Step 4: Run** `npx vitest run tests/workflow tests/guardrails-source.test.ts` — Expected: PASS. First run needs network for the Temporal test server download; if it can't be reached, record that and halt `baseline_red`. Then `npx tsc --noEmit` — Expected: no errors.
- [ ] **Step 5: By hand (no automated test at `src/main.ts`/`worker.ts`, test-strategy):** confirm `main.ts` still type-checks and builds the worker with the shared `sendEmail`; record the check in the commit message.
- [ ] **Step 6: Commit**

```bash
git add src/temporal src/main.ts tests/workflow tests/guardrails-source.test.ts
git commit -m "feat: planWorkflow open phase calls off a plan below its minimum"
```

### Task 5: Called-off pages (P1, P2, W1)

**Covers:** AC6, AC7, AC8

**Files:**
- Modify: `src/web/views/public-plan-page.ts`, `src/web/views/public-plan-page.test.ts`, `src/web/routes/public.test.ts`, `src/web/routes/withdraw.test.ts`, `public/app.css`

**Interfaces:**
- Consumes: `displayState`, `publicPlanOg`, `publicPlanPage` (unchanged signatures); `loadPlan` for read-back.
- Produces: the public page's pill is `<p class="pill state-off">Not this time</p>` for `not_this_time`; `publicPlanOg(...).description` is exactly `"Not this time"` for that state; with `notice.code === 'closed'` the notice `<p class="notice" role="status">` renders before the pill.

- [ ] **Step 1: Write the failing tests** (one at a time).
  - View: `a not_this_time page has a pill with class state-off, no form` and `og description for not_this_time is "Not this time"` (`publicPlanOg(plan, 'not_this_time', baseUrl).description`); `closed notice comes before the pill` (`body.indexOf('This one isn\'t taking commits any more.') < body.indexOf('class="pill state-off"')`).
  - Route `public.test.ts` (AC6): `GET /p/:token` of a plan called off through `resolveDeadline`: body contains `class="pill state-off"` and `Not this time`, no `<form`, and the `og:description` meta content is `Not this time`.
  - Route `public.test.ts` (AC7): `POST /p/:token/commit` on the called-off plan → 303 with `location` `/p/<token>?notice=closed`; `loadPlan(...)` count and `commit.added` events unchanged; following the redirect renders the closed notice above the pill and no form.
  - Route `withdraw.test.ts` (AC8): after calling the plan off, `GET /w/:token` for a committer's token contains `This one isn't going ahead, so there's nothing to withdraw from.` and no `<button`. (Passes already; shown RED by temporarily mutating the sentence, then restored.)
- [ ] **Step 2: Run** `npx vitest run src/web` — Expected: FAIL on the `state-off`, `og` and notice-order tests only.
- [ ] **Step 3: Implement in `public-plan-page.ts`**: add `state-off` to the pill's class when `state === 'not_this_time'`; return `"Not this time"` as the og description for that state; render the `closed` notice above the pill. In `public/app.css` add `.state-off { background: var(--off-tint); color: var(--text-2); }` (define `--off-tint: #E8E5ED` only if the variable doesn't exist; the new-look palette is story 3.7).
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc --noEmit` — Expected: whole suite PASS, no type errors.
- [ ] **Step 5: Commit**

```bash
git add src/web public/app.css
git commit -m "feat: called-off pages match P1, P2 and W1"
```

## Self-Review

- **AC coverage:** AC1 → Tasks 2, 4 (and subject in 1); AC2 → 1; AC3 → 3, 4; AC4 → 2, 4; AC5 → 3, 4; AC6–AC8 → 5.
- **Types:** `createActivities` deps (`db`, `sendEmail`, `baseUrl`), `resolveDeadline(db, planId)` and `sendToCommitters(planId, kind)` are used identically in Tasks 2–4; `Activities` is the only type the workflow imports.
- **Proportion:** bodies are left to signatures and tests; only exact copy and option values are written out.
