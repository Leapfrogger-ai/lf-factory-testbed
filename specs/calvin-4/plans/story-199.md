# Call a plan off through the manage link: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /m/:token/call-off` (R8) lets the creator call an open or confirmed plan off, and the plan's workflow then emails "Not this time" to the active committers and ends.

**Architecture:** A new domain function `callOff` locks the plan row, refuses a plan already called off or already started, and otherwise sets `called_off` with reason `creator` and appends `plan.called_off`. The route in `src/web/routes/manage.ts` signals `calledOff` after the commit (a failure is logged, never fatal) and redirects 303. The manage page renders the `?notice=too-late` notice (frame M4). The workflow already reacts to `calledOff` in its open phase; it doesn't once the plan is confirmed, so its confirmed phase is extended under a `patched()` marker so a call-off between confirmation and the gathering stops the reminders and sends `not_this_time`.

**Tech Stack:** Hono, Drizzle on Postgres, Temporal TS SDK 1.24.0 with `TestWorkflowEnvironment.createTimeSkipping()`, Vitest 5, Node 26 native TypeScript.

**Spec:** .factory/story.md (story #199)

## Global Constraints

- Use Temporal's signals (`defineSignal`, `setHandler`, `WorkflowHandle.signal`) to wake a plan's workflow on confirm, late commit and call-off; don't poll Postgres for state changes — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Temporal's `patched()` / `deprecatePatch()` for any change to `planWorkflow` once plans are live, with a replay test against a recorded history; don't hand-roll version flags — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use `@temporalio/testing`'s `TestWorkflowEnvironment.createTimeSkipping()` to test the plan workflow's timers; don't fake clocks or mock `sleep` — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use `hono/csrf` for CSRF protection on every POST; don't add hidden form tokens — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Hono's `app.request()` for route tests; don't add supertest or listen on a port — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Drizzle's `db.transaction` and `.for('update')` for commit, confirm, call-off and deadline resolution; don't add application locks — [finding](specs/calvin/research/node-hono-drizzle.md).
- Plan and commit state changes only in `src/domain/plans.ts`, inside a transaction that locks the plan row and appends its event through `appendEvent` — one source of truth, and commit races settle on the row lock. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Workflow code imports only `@temporalio/workflow` and types, gets its schedule as epoch milliseconds, and uses neither `Intl` nor JS `Temporal` — workflow code must replay deterministically. ([ADR 0001](docs/adr/0001-temporal-workflow-per-plan.md))
- Every activity re-reads Postgres and acts only if the plan's state still matches (no reminder unless `confirmed`, no `not_this_time` unless `called_off`, nothing to withdrawn committers) — signals are hints, not state. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address — SQL and I/O stay in one module, and NFR006 holds by construction.
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed in. ([test-strategy](specs/calvin/test-strategy.md))
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Errors follow the architecture's Error Handling section: a field error re-renders the same page with 422 and keeps what was entered, any bad token is the same 404 page (a malformed one without a database query), a suggestion failure is a fallback card and never a 5xx, and anything unexpected goes to `app.onError` with no stack trace on the page — users never see a different error shape per route.
- A Temporal signal or start failure after a committed transaction is logged at `error` and never fails the user's request — the commit already stands. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities. ([ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- No secret is read, stored, logged or committed other than as the architecture's Secrets table says (env vars from Fly secrets or a gitignored `.env`; never in `fly.toml`, the Dockerfile, the repo, a log line or a CI command line; `.env.example` holds names only) — a leaked secret can't be taken back.
- Tests verify behaviour through public interfaces, at the seams `specs/calvin/test-strategy.md` names — tests that reach inside break on every refactor.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- The request logger writes the path with tokens replaced by `:token` and never logs query strings, emails, tokens or `Fly-Client-IP`. (api-specification.md)
- Pages are plain HTML forms that work without JavaScript. (architecture.md)
- `TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database. (test-strategy.md; this worktree's ports and database come from `FACTORY_PORT_BASE` and `FACTORY_DB_NAME`, so run tests as `npx vitest run` and never hard-code a port or database name.)
- Commands: test is `npx vitest run`; build is `npx tsc --noEmit`. (test-strategy.md)

Binding: CODING_STANDARDS.md, GLOSSARY.md, specs/calvin-4/test-strategy.md, specs/calvin-4/architecture.md, specs/calvin-4/api-specification.md, docs/adr/0001-temporal-workflow-per-plan.md, docs/adr/0002-postgres-owns-state-temporal-owns-time.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md

## Review Focus

- A malformed token, or a well-formed unknown one, POSTed to call-off is the same 404 page, a malformed one with no database query, and nothing is signalled. Pinned in Task 2.
- A call-off posted at exactly the gathering instant is "too late" (now ≥ gathering, FR023), with no write and no signal. Pinned in Task 1.
- Two call-offs racing, or a double click, leave one `plan.called_off` event and one signal's worth of emails. Pinned in Task 1 (second call is `already_called_off`) and Task 2 (no second signal).
- A committer who withdrew before the call-off gets no "Not this time" email, and a committer already emailed isn't emailed twice. Pinned in Task 4.
- A call-off signal arriving while the workflow waits for a reminder, or after both reminders went out, still ends it with one `not_this_time` round and no later reminder or check-in. Pinned in Task 4.
- An unknown `?notice=` value on the manage page shows nothing, and the notice copy is escaped text. Pinned in Task 3.

## Rulings

Ruling: R8 is followed literally, so an `open` plan past its commit deadline but before its gathering can still be called off (reason `creator`, `wasConfirmed: false`) if the workflow's deadline timer hasn't resolved it first — the spec's only refusals are already-called-off and started, and the end state is the same — if wrong, one more refusal condition in `callOff`.
Ruling: The workflow's confirmed phase stops on a `calledOff` signal only (not by polling Postgres), under a new patch marker `call-off-3-5` placed inside the `reminders-3-3` branch, so histories recorded by 3.2 and 3.3 replay unchanged and the existing replay tests are the replay evidence — if wrong, a plan confirmed under the old workflow and called off keeps its reminders (the activities' state check still stops them sending) and gets no "Not this time" email.
Ruling: `callOff` returns `{ outcome: 'not_found' | 'already_called_off' | 'too_late' | 'called_off' }`; `called_off` carries `planId` for the signal — the route needs nothing else — if wrong, a field is added.
Ruling: The `too-late` notice is a neutral `.notice` paragraph with `role="status"` (frame M4), and `managePage` takes an optional `notice?: 'too-late'` that the route sets only for that exact query value — if wrong, one string comparison changes.

---

### Task 1: `callOff` in the domain

**Covers:** AC1, AC2, AC3, AC4

**Files:**
- Modify: `src/domain/plans.ts` (after `withdraw`), `src/domain/plans.test.ts`

**Interfaces:**
- Consumes: `appendEvent` (`src/domain/events.ts`), the `plans` and `commits` tables, `AppDeps['db' | 'now']`.
- Produces: `export type CallOffResult = { outcome: 'not_found' } | { outcome: 'already_called_off' } | { outcome: 'too_late' } | { outcome: 'called_off'; planId: string }` and `export async function callOff(deps: Pick<AppDeps, 'db' | 'now'>, manageToken: string): Promise<CallOffResult>`.

- [ ] **Step 1: Write the failing test** `callOff calls an open plan off` in `src/domain/plans.test.ts` (publish with `publishPlan`, clock 2026-11-09T18:00:00Z, gathering Sat 14 Nov). Assert `{ outcome: 'called_off', planId }`; the plan row has `state: 'called_off'`, `calledOffReason: 'creator'`, a non-null `calledOffAt`; and exactly one `plan.called_off` event with data `{ reason: 'creator', wasConfirmed: false, activeCount: 1 }`. Read through `loadPlan`.
- [ ] **Step 2: Run** `npx vitest run src/domain/plans.test.ts -t "calls an open plan off"`. Expected: FAIL, `callOff` is not exported.
- [ ] **Step 3: Implement** `callOff` in `src/domain/plans.ts`: find the plan by `manageToken` with `.for('update')` inside `deps.db.transaction`; no row → `not_found`; `state === 'called_off'` → `already_called_off` (checked before the time rule, as R8 orders them); `now ≥ gatheringAt` → `too_late`; else update `state: 'called_off'`, `calledOffAt: new Date(now.epochMilliseconds)`, `calledOffReason: 'creator'`, count active commits as `withdraw` does, and `appendEvent` `plan.called_off` with `wasConfirmed: plan.state === 'confirmed'`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Add one test, then its behaviour, at a time**, each shown RED first:
  - `records wasConfirmed true for a confirmed plan`: publish with `minimum: '2'`, `commit` Mia (confirms), call off → event data `{ reason: 'creator', wasConfirmed: true, activeCount: 2 }`.
  - `counts only active commits`: Mia commits then `withdraw`s, call off → `activeCount: 1`.
  - `writes nothing for a plan already called off`: second call returns `already_called_off`; the events list still has exactly one `plan.called_off`.
  - `writes nothing once the gathering started`: clock `2026-11-14T18:00:00Z` (the gathering instant, 10:00 PST) → `too_late`, state still `open`, no `plan.called_off` event.
  - `returns not_found for an unknown token`: `callOff(deps, newToken())` → `{ outcome: 'not_found' }`.
- [ ] **Step 6: Run** `npx vitest run src/domain/plans.test.ts` and `npx tsc --noEmit`. Expected: PASS, no type errors.
- [ ] **Step 7: Commit**

```bash
git add src/domain/plans.ts src/domain/plans.test.ts
git commit -m "Call a plan off in the domain"
```

### Task 2: `POST /m/:token/call-off`

**Covers:** AC1, AC3, AC4, AC5, AC6

**Files:**
- Modify: `src/web/routes/manage.ts`, `src/web/routes/manage.test.ts`

**Interfaces:**
- Consumes: `callOff` and `CallOffResult` (Task 1), `deps.planWorkflows.signal(planId, 'calledOff')`, `log` from `src/log.ts`, `isToken`.
- Produces: the route `POST /m/:token/call-off`, the same 404 page as `GET /m/:token` for a bad or unknown token; 303 `/m/<token>` for `called_off` and `already_called_off`; 303 `/m/<token>?notice=too-late` for `too_late`.

- [ ] **Step 1: Write the failing test** `POST /m/:token/call-off calls an open plan off (AC1)` in a new `describe('POST /m/:token/call-off')` in `src/web/routes/manage.test.ts`, with a `postCallOff(app, token)` helper like `postWithdraw` in `withdraw.test.ts` (form content type, `Origin: TEST_BASE_URL`, `...sameOrigin`, empty body). Assert status 303, `Location` is `/m/${manageToken}`, `loadPlan` shows `state: 'called_off'` and a `plan.called_off` event with `wasConfirmed: false`, and `deps.fakes.planWorkflows.signalCalls` equals `[{ planId, signal: 'calledOff', arg: undefined }]`.
- [ ] **Step 2: Run** `npx vitest run src/web/routes/manage.test.ts -t "call-off"`. Expected: FAIL, the route answers 404.
- [ ] **Step 3: Implement** the route in `manageRoutes`: not a token → the 404 page without a query; `callOff`; `not_found` → 404 page; `too_late` → `c.redirect(\`/m/${token}?notice=too-late\`, 303)`; `already_called_off` → redirect `/m/${token}` with no signal; `called_off` → `try { await deps.planWorkflows.signal(result.planId, 'calledOff') } catch (error) { log.error('plan signal failed', { planId, signal: 'calledOff', errorName: error instanceof Error ? error.name : 'unknown' }) }`, then redirect `/m/${token}`. Reuse the 404 rendering already in the `GET /m/:token` handler rather than duplicating it.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Add one test, then its behaviour, at a time**, each shown RED first:
  - `leaves a plan already called off alone (AC3)`: post twice → both 303 to `/m/<token>`, one `plan.called_off` event, one signal call.
  - `refuses once the gathering started (AC4)`: app built with `now: fixedClock('2026-11-14T18:00:01Z')` → 303 `/m/<token>?notice=too-late`, plan still `open`, no event, no signal.
  - `still calls the plan off when the signal fails (AC5)`: `planWorkflows.signal` replaced by a function that throws `new Error('temporal down')`; response 303 `/m/<token>`, plan `called_off`, and the log is captured at `error` with `planId` (follow how `public.test.ts` asserts the commit route's signal failure; if it spies on `log`, reuse that exact seam, no new mock of a project module).
  - `rejects a cross-origin POST (AC6)`: `Origin: 'https://evil.test'`, `Sec-Fetch-Site: 'cross-site'` → 403 and `loadPlan` still `open`, no signal.
  - `404s an unknown token and a malformed one without a query`: copy the Proxy-db technique used for `GET /m/:token` (AC7 test in the same file) for the malformed token.
- [ ] **Step 6: Run** `npx vitest run src/web/routes/manage.test.ts` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 7: Commit**

```bash
git add src/web/routes/manage.ts src/web/routes/manage.test.ts
git commit -m "POST /m/:token/call-off"
```

### Task 3: The too-late notice on the manage page

**Covers:** AC4

**Files:**
- Modify: `src/web/views/manage-page.ts`, `src/web/views/manage-page.test.ts`, `src/web/routes/manage.ts`, `src/web/routes/manage.test.ts`

**Interfaces:**
- Consumes: `managePage({ plan, state, publicLink, now })` (existing).
- Produces: `managePage` also accepts `notice?: 'too-late'`; with it the page has `<p class="notice" role="status">It's already started, so it can't be called off.</p>` as the first element after the wordmark (`brand`) and before the pill, as in frame M4. `GET /m/:token?notice=too-late` passes it; any other value passes nothing.

- [ ] **Step 1: Write the failing test** in `src/web/views/manage-page.test.ts`: `shows the too-late notice above the pill (AC4)` for a `happening_now` plan with `notice: 'too-late'`; assert the output contains `<p class="notice" role="status">It&#39;s already started, so it can&#39;t be called off.</p>` (match the escaping the other view tests use; decode as they do if needed) and that its index is less than the index of `class="pill`.
- [ ] **Step 2: Run** `npx vitest run src/web/views/manage-page.test.ts -t "too-late"`. Expected: FAIL (no notice rendered; the `notice` option is a type error until added).
- [ ] **Step 3: Implement** the optional `notice` parameter in `managePage` and render the paragraph between `${brand}` and the pill.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Add one test, then its behaviour, at a time**, each RED first:
  - View: `shows no notice without the option`: output has no `class="notice"`.
  - Route, in `manage.test.ts`: `GET /m/:token?notice=too-late shows the notice, and an unknown notice shows none`: clock after the gathering; `?notice=too-late` body contains the copy (decoded) and "Happening now"; `?notice=other` body contains no `class="notice"`. Implement by reading `c.req.query('notice')` and passing `notice: 'too-late'` only on an exact match.
- [ ] **Step 6: Run** `npx vitest run src/web` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 7: Commit**

```bash
git add src/web/views/manage-page.ts src/web/views/manage-page.test.ts src/web/routes/manage.ts src/web/routes/manage.test.ts
git commit -m "Show the too-late notice on the manage page"
```

### Task 4: Stop a confirmed plan's workflow on `calledOff`

**Covers:** AC2

**Files:**
- Modify: `src/temporal/workflows.ts`, `tests/workflow/plan-workflow.test.ts`

**Interfaces:**
- Consumes: the existing `calledOff` signal and `isCalledOff` flag, `activities.sendToCommitters(planId, 'not_this_time')` (acts only if the plan is `called_off`, skips withdrawn committers, once per commit through `sendOnce`), `callOff` (Task 1) to set up state, the test helpers `confirmedPlan`, `runSchedule`, `timedEmail`, `EXAMPLE`, `sent`, `startingWith`.
- Produces: in the confirmed phase, after `patched('call-off-3-5')`, a `calledOff` signal ends every wait (`waitUntil` and the final check-in wait), and the workflow then sends `not_this_time` once and returns, sending no further reminder or check-in. Plans whose history has no marker behave as before.

- [ ] **Step 1: Write the failing test** `sends Not this time to everyone and no reminder after a call-off between confirmation and the 24h reminder (AC2)` in a new `describe('planWorkflow call-off')` in `tests/workflow/plan-workflow.test.ts`. Use `runSchedule` with `EXAMPLE` and `confirmAt: '2026-11-12T18:00:00Z'` (the confirmed emails go out); in `act`, call `callOff(deps, published.manageToken)` (so Postgres says `called_off`, with the deps clock before the gathering), `h.signal(calledOff)`, then `env.sleep` past the check-in instant. Assert exactly one email per active committer starts with the not-this-time subject (take the subject and body from `src/email/templates.ts` for the example plan, as an ISO/literal string in the test, not by calling the template), no email starts with `Tomorrow:` or `Today:`, and the workflow result resolves.
- [ ] **Step 2: Run** `npx vitest run tests/workflow/plan-workflow.test.ts -t "call-off"`. Expected: FAIL: the workflow ignores the signal, sends the 24h reminder (the activity's state check stops the send, so the failure is the missing `not_this_time` email) and runs to the check-in.
- [ ] **Step 3: Implement** in `planWorkflow`, inside the `patched('reminders-3-3')` branch: `const stopOnCallOff = patched('call-off-3-5')`. When true, `waitUntil` uses `condition(() => lateCommitIds.length > 0 || isCalledOff, remaining)` and returns as soon as `isCalledOff`; after each `waitUntil` and before each reminder send, `if (isCalledOff) { await activities.sendToCommitters(input.planId, 'not_this_time'); return; }`. When false, keep today's code path exactly. Keep the late-commit drain loop from sending `confirmed` once `isCalledOff` is set.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Add one test, then its behaviour, at a time**, each RED first:
  - `sends no morning reminder or check-in after a call-off between the two reminders`: let the 24h reminder go out (`env.sleep` past it), then call off and signal; assert the 24h reminder exists once, no `Today:` email, one not-this-time email per active committer.
  - `sends Not this time once each, and not to a committer who withdrew`: Raj withdraws (`withdraw` from `plans.ts`) before the call-off; assert Ann and Mia get one each and Raj none, and signalling `calledOff` twice does not add emails.
  - `replays a history recorded after this patch`: after the new run, `Worker.runReplayHistory({ workflowsPath }, await handle.fetchHistory())` resolves.
  - The existing `replays a history recorded before the reminders patch` test (recorded 3.2 history and a fresh 3.3 history) must still pass unchanged.
- [ ] **Step 6: Run** `npx vitest run` (the whole suite) and `npx tsc --noEmit`. Expected: all PASS.
- [ ] **Step 7: Commit**

```bash
git add src/temporal/workflows.ts tests/workflow/plan-workflow.test.ts
git commit -m "Stop a confirmed plan's workflow when it is called off"
```
