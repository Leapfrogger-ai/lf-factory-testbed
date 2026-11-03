# A plan is confirmed when it reaches its minimum (Story 2.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The commit that brings the active count to the minimum confirms the plan in the same transaction, signals its workflow afterwards, and the public page shows every confirmed state.

**Architecture:** `commit()` in `src/domain/plans.ts` gains the confirm step inside its existing row-locked transaction (state, `confirmed_at`, `plan.confirmed` event) and returns what the route needs to choose a notice and a signal. `POST /p/:token/commit` signals `planWorkflows.signal` after the transaction, catching and logging failures. `displayState` and `publicPlanPage` learn the `happening_now` and `was_on` states and the `on` notice.

**Tech Stack:** Node 26 + TypeScript (type stripping), Hono + `hono/html`, Drizzle on Postgres 17, Vitest 5.

**Spec:** .factory/story.md (story #174)

## Global Constraints

- Plan and commit state changes only in `src/domain/plans.ts`, inside a transaction that locks the plan row and appends its event through `appendEvent` — one source of truth, and commit races settle on the row lock. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- A Temporal signal or start failure after a committed transaction is logged at `error` and never fails the user's request — the commit already stands. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Every activity re-reads Postgres and acts only if the plan's state still matches (no reminder unless `confirmed`, no `not_this_time` unless `called_off`, nothing to withdrawn committers) — signals are hints, not state. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address — SQL and I/O stay in one module, and NFR006 holds by construction.
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed in. ([test-strategy](specs/calvin/test-strategy.md))
- Times are stored as UTC `timestamptz`, and every local-time rule and display format goes through `src/domain/time.ts` with `PLAN_TIME_ZONE` — one place for DST and the UX §8.8 formats.
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities. ([ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Drizzle's `db.transaction` and `.for('update')` for commit, confirm, call-off and deadline resolution; don't add application locks — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Hono's `app.request()` for route tests; don't add supertest or listen on a port — [finding](specs/calvin/research/node-hono-drizzle.md).
- Tests verify behaviour through public interfaces, at the seams `specs/calvin/test-strategy.md` names — tests that reach inside break on every refactor.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- No implementation-coupled tests. Test through the seam's interface. A route test checks the response and the recorded boundary calls, not the database. A Plan operations test reads state back through `domain/plans.ts` functions, not with its own SQL. The one exception is the Send ledger seam: its test may count `email_sends` rows, because the ledger is its interface.
- Each route's outcome table in api-specification.md is that route's test list.
- `TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database.
- Form requests must set `Content-Type: application/x-www-form-urlencoded`, or the validator sees `{}`, and must set `Origin: <BASE_URL>` to pass CSRF.
- No page, URL or redirect ever contains an email address.
- No secret is read, stored, logged or committed other than as the architecture's Secrets table says (env vars from Fly secrets or a gitignored `.env`; never in `fly.toml`, the Dockerfile, the repo, a log line or a CI command line; `.env.example` holds names only) — a leaked secret can't be taken back.

Binding: CODING_STANDARDS.md, GLOSSARY.md, docs/adr/0002-postgres-owns-state-temporal-owns-time.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md, specs/calvin-3/test-strategy.md, specs/calvin-3/api-specification.md, specs/calvin-3/architecture.md

## Review Focus

- Two people committing at once when the plan is one short of the minimum must yield one `plan.confirmed` event and one `confirmed` signal; the loser of the row lock sees a confirmed plan and signals `committed`, not `confirmed`. Pinned in Task 1 and Task 3.
- A repeat commit by someone on a plan that is already confirmed (or that tips nothing) must send no signal and show `updated`, not `on`. Pinned in Task 3.
- A signal that throws must not turn the 303 into a 500, and the `error` log line must hold only `planId` and the signal name, no email, token or name. Pinned in Task 3.
- A confirmed plan whose count later drops below the minimum (Story 2.3) or that has more committers than the minimum must still render every seat filled and no "you?" or negative count. Pinned in Task 2.
- The 3-hour boundary: exactly `gathering + 3h` reads "This was on …", one second earlier reads "Happening now"; a commit at exactly the gathering instant is refused. Pinned in Task 2 and Task 3.

---

## Rulings

Ruling: `commit()` returns `planId`, `confirmed` (this commit confirmed the plan) and `planConfirmed` (the plan is confirmed after it); the route turns them into a signal and a notice — signals must come after the transaction and the domain has no `planWorkflows` in its `deps` for `commit` — if wrong, the route's small mapping moves, the stored state is unaffected.
Ruling: `DisplayState` gains `happening_now` and `was_on` and is exported from `src/domain/plan-rules.ts`; the view imports it instead of keeping its own copy — one list of states — if wrong, it is a type-only move.
Ruling: `change: 'rejoined'` stays unreachable until Story 2.3; the route treats `change !== 'repeat'` as "new or rejoined" so 2.3 needs no change here — if wrong, 2.3 adjusts one condition.
Ruling: `createPlanWorkflows(...).signal` in `src/temporal/client.ts` is implemented (`getHandle(\`plan-${planId}\`).signal(name, arg)`) with no automated test, because test-strategy lists `src/temporal/client.ts` as untested at poc; `planWorkflow` has no signal handlers until Epic 3, so a sent signal is only recorded in the workflow's history — if wrong, signals are lost until Epic 3 lands, and the commit still stands.
Ruling: The `on` notice says "We've emailed you the details" although the email is Story 3.2 — the copy is fixed by AC1 — if wrong, the page promises an email that is not sent until 3.2 lands.

---

### Task 1: `commit()` confirms the plan at the minimum

**Covers:** AC1, AC3, AC4, AC6

**Files:**
- Modify: `src/domain/plans.ts`
- Test: `src/domain/plans.test.ts`

**Interfaces:**
- Consumes: existing `commit(deps, publicToken, form)`, `appendEvent`, `loadPlan` (read-back: `state`, `count`, `events`), `publishPlan`/`testDeps` and `fixedClock` from `tests/support`.
- Produces:
  ```ts
  export type CommitResult =
    | { outcome: 'not_found' }
    | { outcome: 'closed' }
    | { outcome: 'committed'; change: 'new' | 'repeat'; commitId: string; name: string;
        planId: string; confirmed: boolean; planConfirmed: boolean };
  ```
  `confirmed` is true only for the commit that moved the plan `open → confirmed`; `planConfirmed` is true whenever the plan is `confirmed` after the commit.

- [ ] **Step 1: Write the failing test** `confirms the plan when the commit reaches the minimum` in `plans.test.ts` (example plan: Ana publishes, minimum 3; Raj commits `raj@example.test`; Mia commits `mia@example.test`): `loadPlan(...).state` is `'confirmed'`; the last two events are `commit.added` (`change: 'new'`, `activeCount: 3`) then `{ type: 'plan.confirmed', data: { activeCount: 3 } }`; the result has `confirmed: true, planConfirmed: true`; after Raj's commit alone the plan is still `open` with `confirmed: false, planConfirmed: false`.
- [ ] **Step 2: Run** `npx vitest run src/domain/plans.test.ts -t "confirms the plan"` — Expected: FAIL (state stays `open`).
- [ ] **Step 3: Implement** in `commit()`, after the active count is read and before `commit.added` is appended: if `plan.state === 'open'`, `active >= plan.minimum` and `now` is before the commit deadline, `update(plans)` to `state: 'confirmed'`, `confirmedAt: new Date(now.epochMilliseconds)`; append `commit.added`, then `plan.confirmed` with `{ activeCount }`. Extend the returned object per the Interfaces block.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Next test, then code** — `a new commit on a confirmed plan after its commit deadline is stored without a second confirmation` (AC3: confirm at the default clock, then `commit` with `now` `2026-11-13T18:00:00Z`, which is after the 2026-11-12T06:00:00Z deadline and before the 2026-11-14T18:00:00Z gathering; result `committed`, `change: 'new'`, `confirmed: false`, `planConfirmed: true`; `count` 4; exactly one `plan.confirmed` event in total). Run; if it passes first time, mutate the open-only guard (confirm whenever `active >= minimum`) to see it fail, then restore.
- [ ] **Step 6: Next test** — `a repeat commit on a confirmed plan confirms nothing and adds no event of type plan.confirmed` (AC4: Mia commits again as `MIA@Example.test`; `change: 'repeat'`, `confirmed: false`, `planConfirmed: true`; still one `plan.confirmed`).
- [ ] **Step 7: Race test** (AC6, Review Focus) — `two simultaneous commits on a plan one short of its minimum confirm it once`: minimum 3, Ana and Raj in; `Promise.all` of Mia's and Sam's `commit` calls; exactly one result has `confirmed: true`, both have `planConfirmed: true`, `loadPlan` shows one `plan.confirmed` event, state `confirmed`, `count` 4. If it passes first time, remove `.for('update')` to see it fail (or report two confirmations), then restore.
- [ ] **Step 8: Run** `npx tsc --noEmit && npx vitest run src/domain` — Expected: PASS (existing 2.1 tests that assert the exact event list of a plan that reaches 3 must be updated to expect the `plan.confirmed` event; plans below the minimum are unchanged). Commit — `git add src/domain && git commit -m "feat: commit() confirms the plan at its minimum"`

### Task 2: Display states and the confirmed page

**Covers:** AC1, AC2, AC7, AC8

**Files:**
- Modify: `src/domain/plan-rules.ts`, `src/web/views/public-plan-page.ts`, `public/app.css` (only the `--on` / `--on-tint` rules the notice and filled seats need; no new stylesheet)
- Test: `src/domain/plan-rules.test.ts`, `src/web/views/public-plan-page.test.ts`

**Interfaces:**
- Consumes: `PublicPlan`, `formatDay` from `src/domain/time.ts`.
- Produces: `export type DisplayState = 'needs_more' | 'not_this_time' | 'on' | 'happening_now' | 'was_on'` and `displayState(plan: { state: string; commitDeadlineAt: Temporal.Instant; gatheringAt: Temporal.Instant }, now: Temporal.Instant): DisplayState` from `plan-rules.ts` (callers pass the whole `PublicPlan`); `publicPlanPage` accepts the new states and the notice code `on`; `publicPlanOg(plan, state, baseUrl)` appends ` It's on.` for `on`, `happening_now` and `was_on`.

Rules the tests pin:
- `displayState`: `confirmed` and now < gathering → `on`; gathering ≤ now < gathering + 3h → `happening_now`; now ≥ gathering + 3h → `was_on`; the `open` and `called_off` rules are unchanged.
- Pill: `on` "It's on"; `happening_now` "Happening now"; `was_on` `This was on ${formatDay(gatheringAt)}` (UX copy "Sat 14 Nov").
- Seats on the three confirmed states: every committer filled, with the `--on` filled-seat class, no "you?" and no empty seat, whatever the count versus the minimum. The line under the seats: `on` reads exactly "More people are welcome until it starts."; `happening_now` and `was_on` show seats but not that line. The "Goes ahead with a minimum of…Decide by…" line is not shown on confirmed states.
- Form: shown for `needs_more` and `on`; not for `not_this_time`, `happening_now`, `was_on`, nor when the notice replaces it.
- Notice `on`: "You're in, {n}. It's on! We've emailed you the details and we'll remind you the day before." (without `n`: "You're in. It's on! …"), `role="status"`, class `notice notice-on`, replaces the form; the 16-character cap and escaping of `n` are shared with `in` and `updated`.

- [ ] **Step 1: Write the failing test** in `plan-rules.test.ts`, `describe('displayState')`: `confirmed before the gathering is on`, `confirmed one second after the gathering starts is happening_now`, `confirmed at gathering + 3h minus one second is happening_now`, `confirmed at exactly gathering + 3h is was_on` (gathering `2026-11-14T18:00:00Z`; ISO literals for `now`). Run `npx vitest run src/domain/plan-rules.test.ts` — Expected: FAIL.
- [ ] **Step 2: Implement** `displayState` and export `DisplayState` from `plan-rules.ts`; change `public-plan-page.ts` to import it instead of its local copy. Run the same command — Expected: PASS.
- [ ] **Step 3: One view test at a time, RED then GREEN**, in `public-plan-page.test.ts`: `the on state shows the It's on pill, filled seats, no empty seat and the welcome line` (plan `names: ['Ana Ruiz','Raj Rao','Mia Chen']`, minimum 3: contains "It's on" and "More people are welcome until it starts.", does not contain `you?` or `dot-empty`, form `name="email"` present); `a confirmed plan with four committers and minimum 3 renders four filled seats and no "Needs"` (Review Focus); `happening_now shows the pill, the seats and no form`; `was_on shows "This was on Sat 14 Nov" and no form`; `the on notice replaces the form and escapes n` (`n` `<b>Mia</b>` appears escaped; `n` over 16 characters is cut to 16); `the on notice without n`; `publicPlanOg appends " It's on." for on, happening_now and was_on and nothing for needs_more` (`description` ends with `Goes ahead if 3 are in. It's on.`). Existing 2.1 view tests keep passing.
- [ ] **Step 4: Run** `npx tsc --noEmit && npx vitest run src/web/views src/domain/plan-rules.test.ts` — Expected: PASS. Commit — `git add src public && git commit -m "feat: confirmed display states and the on notice"`

### Task 3: Signals, the `on` redirect and the pages through the route

**Covers:** AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8

**Files:**
- Modify: `src/web/routes/public.ts`, `src/temporal/client.ts`
- Test: `src/web/routes/public.test.ts`

**Interfaces:**
- Consumes: `commit` and `CommitResult` (Task 1), `displayState` and the new states, `publicPlanPage` and the `on` notice (Task 2), `deps.planWorkflows.signal(planId: string, signal: string, arg?: unknown): Promise<void>`, `log` from `src/log.ts`, `fakePlanWorkflows().signalCalls`.
- Produces: the finished R6 and the R5 pages; `createPlanWorkflows(client).signal` really signals.

Route behaviour, after `commit()` returns `committed` (the transaction is already over):
1. Signal: `confirmed` → `planWorkflows.signal(planId, 'confirmed')`; else `planConfirmed && change !== 'repeat'` → `signal(planId, 'committed', commitId)`; otherwise none. `await` it inside `try`/`catch`; on failure `log.error('plan signal failed', { planId, signal, errorName })`, nothing else (no email, name, token, message or form).
2. Redirect 303 to `/p/${token}?notice=${code}&n=${encodeURIComponent(firstName(name))}`, `code` `updated` for `repeat`, `on` when `planConfirmed`, else `in`.
3. `GET /p/:token` passes the whole plan to `displayState`; `notice=on` flows through the existing query handling.

Tests (a `confirmedPlan(deps)` helper in the test file publishes the example plan, has Raj commit through `commit()`; each test is RED then GREEN, and the first to pass on its first run is mutation-checked):
- [ ] **Step 1: AC1** `Mia's commit confirms the example plan and signals once` — Mia POSTs: 303, `location` `/p/${publicToken}?notice=on&n=Mia`; GET it: decoded body contains "You're in, Mia. It's on! We've emailed you the details and we'll remind you the day before." and "It's on", no `name="email"`; `loadPlan(db, manageToken)` has state `confirmed` and a `plan.confirmed` event; `deps.fakes.planWorkflows.signalCalls` equals `[{ planId, signal: 'confirmed', arg: undefined }]` (the start call is not in it). Run `npx vitest run src/web/routes/public.test.ts -t "confirms the example plan"` — Expected: FAIL (`notice=in`, no signal), then implement, then PASS.
- [ ] **Step 2: AC2** `a confirmed plan's page shows It's on, every seat filled, the welcome line, the form and the og suffix` — GET at the default clock: contains "It's on", "More people are welcome until it starts.", `name="email"`, no `you?`, `<li class="seat"` count equals the number of committers, and the `og:description` content ends with " It's on.".
- [ ] **Step 3: AC3** `a new commit on a confirmed plan after its deadline signals committed with the new commit's id` — app with `now` `2026-11-13T18:00:00Z` on the same database: Sam POSTs: 303 `notice=on&n=Sam`; the plan's count is 4 through `loadPlan`; `signalCalls` has exactly one entry after the confirming one: `{ signal: 'committed', arg: <Sam's commit id> }`, `arg` is a string, and a second new committer's `committed` signal carries a different `arg` (the commit ID isn't readable through `loadPlan`; Task 1 pins that `commit()` returns the new commit's `commitId`, this test pins that the route passes it on).
- [ ] **Step 4: AC4** `an existing committer committing again sends no signal and shows updated` — after the confirmation, Mia POSTs again as `MIA@Example.test`: `notice=updated&n=Mia`; `signalCalls` still has only the one `confirmed` entry.
- [ ] **Step 5: AC5** `a failing signal leaves the plan confirmed, the response a 303 and an error log line` — `testDeps({ planWorkflows: { ...fakePlanWorkflows(), signal: async () => { throw new Error('temporal down') } } })`, with the `process.stdout.write` spy from the existing logging test: status 303 to `notice=on&n=Mia`; `loadPlan` state `confirmed`; a log line has `level: 'error'`, `msg: 'plan signal failed'`, the plan's `id` as `planId`, `signal: 'confirmed'`; the whole log, the location and the page contain neither `mia@example.test`, nor the public token, nor `temporal down`.
- [ ] **Step 6: AC6** `two simultaneous commits on a plan one short send one confirmed signal` — Ana alone is not enough: Raj committed, then `Promise.all` of Mia's and Sam's POSTs: both 303; `signalCalls` has one `confirmed` and one `committed`; `loadPlan` has one `plan.confirmed` event.
- [ ] **Step 7: AC7 and AC8** `a confirmed plan 3 hours after the gathering started reads happening now, and at 3 hours reads This was on Sat 14 Nov` — apps with `now` `2026-11-14T20:59:59Z` ("Happening now", no `name="email"`, seats shown) and `2026-11-14T21:00:00Z` ("This was on Sat 14 Nov", no `name="email"`); and `a POST once the gathering has started is refused with notice=closed` at `2026-11-14T18:00:00Z` with no signal.
- [ ] **Step 8: Implement** `createPlanWorkflows(...).signal(planId, signal, arg)` in `src/temporal/client.ts` as `client.workflow.getHandle(\`plan-${planId}\`).signal(signal, arg)` (no test: the file has none at poc). Run `npx tsc --noEmit && npx vitest run` — Expected: all PASS, including every earlier route test. Commit — `git add src && git commit -m "feat: signal the plan workflow after a confirming or late commit"`
