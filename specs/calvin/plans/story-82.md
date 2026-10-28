# Story 1.3: Publish a plan from a filled-in form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A creator fills in the plan form on `GET /`, publishes it with `POST /plans`, and lands on a published screen with a public link and a quiet manage link. The story also brings the shared test helpers, the config module and the entry point.

**Architecture:** `POST /plans` parses and validates the form (`src/web/forms.ts`), calls `publish()` in `src/domain/plans.ts`, and redirects 303. `publish()` computes the schedule with the pure `plan-rules.ts` and the `time.ts` helpers (JS `Temporal`), then, in one transaction, inserts the plan, the creator's commit and two events, and calls `planWorkflows.start` before the transaction commits. `src/main.ts` builds the real `deps` and starts the HTTP server and a Temporal worker on task queue `calvin`.

**Tech Stack:** Node 26 (type stripping, JS `Temporal`), Hono + `hono/html` + `@hono/zod-validator`, zod 4, Drizzle 0.45.4 + `pg`, `@temporalio/client|worker|workflow|envconfig` 1.24.0, Vitest 5 with the worktree's `embedded-postgres`.

**Spec:** .factory/story.md (story #82)

## Global Constraints

- Use Node 26's JS `Temporal` (`Temporal.ZonedDateTime` in `America/Los_Angeles`) for all local-time math; don't do manual offset math or add `date-fns-tz` or `luxon` — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Node 26's native TypeScript type stripping to run `.ts`; don't add a `tsc`/esbuild build pipeline — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `crypto.randomBytes(32).toString('base64url')` (through `newToken()`) for capability tokens; don't use `randomUUID` or a custom scheme — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `c.req.parseBody()` and `@hono/zod-validator` with an error hook for forms; don't parse bodies by hand — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Hono's `app.onError`, `app.notFound` and `HTTPException` for the error and not-found pages; don't try/catch in every route — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Hono's `app.request()` for route tests; don't add supertest or listen on a port — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Drizzle's `db.transaction` and `.for('update')` for commit, confirm, call-off and deadline resolution; don't add application locks — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Temporal's workflow ID uniqueness (`workflowId: plan-<planId>`, default conflict policy) for one workflow per plan; don't keep a "workflow started" flag in Postgres — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use `@temporalio/envconfig`'s `loadClientConnectConfig()` to connect the client and worker; don't wire address, namespace, TLS and API key by hand — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Plan and commit state changes only in `src/domain/plans.ts`, inside a transaction that locks the plan row and appends its event through `appendEvent` — one source of truth, and commit races settle on the row lock. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Workflow code imports only `@temporalio/workflow` and types, gets its schedule as epoch milliseconds, and uses neither `Intl` nor JS `Temporal` — workflow code must replay deterministically. ([ADR 0001](docs/adr/0001-temporal-workflow-per-plan.md))
- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address — SQL and I/O stay in one module, and NFR006 holds by construction.
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed in. ([test-strategy](specs/calvin/test-strategy.md))
- Times are stored as UTC `timestamptz`, and every local-time rule and display format goes through `src/domain/time.ts` with `PLAN_TIME_ZONE` — one place for DST and the UX §8.8 formats.
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Errors follow the architecture's Error Handling section: a field error re-renders the same page with 422 and keeps what was entered, any bad token is the same 404 page (a malformed one without a database query), a suggestion failure is a fallback card and never a 5xx, and anything unexpected goes to `app.onError` with no stack trace on the page — users never see a different error shape per route.
- Environment variables are read only in `src/config.ts` (and `DATABASE_URL` in `src/db/migrate.ts`), validated with zod at startup — one place says what the app needs.
- No secret is read, stored, logged or committed other than as the architecture's Secrets table says (env vars from Fly secrets or a gitignored `.env`; never in `fly.toml`, the Dockerfile, the repo, a log line or a CI command line; `.env.example` holds names only) — a leaked secret can't be taken back.
- Tests verify behaviour through public interfaces, at the seams `specs/calvin/test-strategy.md` names — tests that reach inside break on every refactor.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- Every DST-sensitive rule has a test on 2026-11-01 and 2027-03-14 in `America/Los_Angeles` — that's where local-time rules break.
- `TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database.
- `resetDb()` truncates every table (`TRUNCATE … RESTART IDENTITY CASCADE`) and runs in each integration file's `beforeEach`.
- `src/main.ts`, `src/config.ts`, `src/temporal/client.ts`, `src/temporal/worker.ts`, `src/log.ts`'s transport and `public/create.js` have no automated tests at poc. The first story that touches each checks it by hand and records how in its plan.
- `src/config.ts` validates that each secret is present at startup and never prints values. Errors name the missing variable only.
- `CITIES` in `src/config.ts`, in this order: San Francisco, Oakland, Berkeley, Alameda, Emeryville, Daly City, San Mateo, Redwood City, Palo Alto, Mountain View, Sunnyvale, Santa Clara, San Jose, Fremont, Walnut Creek. All use `America/Los_Angeles`.
- `:token` must match `^[A-Za-z0-9_-]{43}$`. Anything else is a 404 **without a database query**
- Always **303** after a POST (`c.redirect(url, 303)`), so back and refresh never resubmit (UX §8.5)
- `tsconfig.json` sets `"erasableSyntaxOnly": true`, `"verbatimModuleSyntax": true`, `"noEmit": true` and `"allowImportingTsExtensions": true`. No enums and no namespaces; use `import type` for types. Imports use the `.ts` extension.
- All `@temporalio/*` packages are pinned to exactly the same version.

Binding: CODING_STANDARDS.md, GLOSSARY.md, specs/calvin/test-strategy.md, specs/calvin/architecture.md, specs/calvin/api-specification.md, docs/adr/0001-temporal-workflow-per-plan.md, docs/adr/0002-postgres-owns-state-temporal-owns-time.md

## Review Focus

- A gathering at a wall-clock time that doesn't exist or is repeated (2027-03-14 02:30, 2026-11-01 01:30) → parsed with `disambiguation: "compatible"`, no crash. Pinned in Task 2.
- A gathering less than 48h away, or in the past → default deadline is halfway; a past gathering gets the 422 "The gathering needs to be in the future." Pinned in Tasks 2 and 5.
- A Decide by at or after the gathering, in the past, or with only one of date/time → 422 under **Decide by**, the form keeps what was entered. Pinned in Task 5.
- Name or venue holding `<script>` or `&` → HTML-escaped on the form re-render. Pinned in Task 5.
- Email with capitals or spaces (`  Ann@Example.TEST `) → trimmed, stored as typed-trimmed, `emailNormalized` lowercased. Pinned in Task 3.

## Rulings

Ruling: `planWorkflows.start(planId, schedule)` receives the schedule as ISO-8601 UTC strings (`{ deadlineAt, reminder24At, reminderMorningAt | null, checkInAt }`) — AC7 states the instants as ISO literals and the fake records the call as given; the real `planWorkflows` converts them to epoch milliseconds for the workflow input (ADR 0001) — if wrong, only the conversion in `src/temporal/client.ts` changes.

Ruling: `createApp(deps, config)` takes `config: { baseUrl: string }` as a second argument; `AppDeps` keeps its five boundaries — `BASE_URL` is configuration, not a boundary; existing `app.test.ts` calls are updated to pass it — if wrong, move it into deps.

Ruling: no email is sent and no `manage_link` ledger row is written in this story (the story names neither; `sendOnce` has no story yet), so R4's meta line always shows the "We couldn't email you your private link…" variant — it's the truthful line while nothing is sent; the first story that sends the email switches it on the ledger row.

Ruling: CSRF, security headers, rate limiting and the request logger are not added (api-specification §2 headers belong to Story 1.6, per the Story 1.1 plan's scope note); `app.onError` writes one `console.error` line with the error's name only (no message, no stack) until `src/log.ts` exists — if wrong, swap the call for the logger in Story 1.6.

Ruling: `suggestPlanCall` and `sendEmail` in `main.ts` are stubs that throw "not available yet" — no story in this cut uses them, and `config.ts` still validates their variables so the app fails fast on a bad environment — if wrong, the first story using them replaces the stubs.

## File Structure

- `src/domain/tokens.ts` — `newToken()`.
- `src/domain/time.ts` — `PLAN_TIME_ZONE`, wall-clock ↔ instant helpers.
- `src/domain/plan-rules.ts` — pure `defaultDeadline`, `computeSchedule`, `Schedule`.
- `src/web/forms.ts` — zod schema for the publish form.
- `src/domain/events.ts` — `EventData` union and `appendEvent`.
- `src/domain/plans.ts` — `publish`, `loadPlan`, `countPlans`.
- `src/db/client.ts` — `createDb(url)`.
- `tests/support/{fakes,db,builders}.ts` — shared test helpers.
- `src/web/routes/create.ts`, `src/web/routes/manage.ts`; views `create-page.ts`, `published-page.ts`, `system-error-page.ts`; `layout.ts` updated; `public/app.css`.
- `src/config.ts`, `src/temporal/{client,worker,workflows}.ts`, `src/main.ts`, `.env.example`.

---

### Task 1: Capability tokens

**Covers:** AC6

**Files:**
- Create: `src/domain/tokens.ts`, `src/domain/tokens.test.ts`

**Interfaces:**
- Produces: `newToken(): string` — 43 base64url characters.

- [ ] **Step 1: Write the failing test** `tokens.test.ts` › "newToken returns 43 base64url characters, all different": generate 1000 tokens, assert each matches `/^[A-Za-z0-9_-]{43}$/` and `new Set(tokens).size === 1000`.
- [ ] **Step 2: Run** `npx vitest run src/domain/tokens.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `newToken(): string` as `randomBytes(32).toString('base64url')` from `node:crypto`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/domain/tokens.ts src/domain/tokens.test.ts && git commit -m "feat: newToken"`

### Task 2: Time helpers and plan rules

**Covers:** AC1, AC2, AC3, AC4, AC8, AC9, AC10

**Files:**
- Create: `src/domain/time.ts`, `src/domain/plan-rules.ts`, `src/domain/plan-rules.test.ts`
- Modify: `src/temporal-types.d.ts` (declare the `Temporal` runtime global's members used: `Instant.from`, `Instant.add/subtract/since`, `PlainDateTime.from`, `ZonedDateTime` with `toInstant`, `add`, `startOfDay`, `with`, `toPlainDate`, etc.; TypeScript 7's lib doesn't ship them — declare only what the code uses, and use `declare const Temporal` so the global resolves)

**Interfaces:**
- Produces (`time.ts`): `PLAN_TIME_ZONE = 'America/Los_Angeles'`; `localToInstant(date: string, time: string): Temporal.Instant` (wall-clock in `PLAN_TIME_ZONE`, `disambiguation: 'compatible'`; `date` is `YYYY-MM-DD`, `time` is `HH:MM`); `localOn(instant: Temporal.Instant, hour: number, dayOffset: number): Temporal.Instant` (the `hour`:00 wall-clock in `PLAN_TIME_ZONE`, `dayOffset` days after the instant's local date).
- Produces (`plan-rules.ts`): `type Schedule = { deadlineAt: string; reminder24At: string; reminderMorningAt: string | null; checkInAt: string }` (ISO UTC strings, as `Instant.toString()` gives); `defaultDeadline(now: Temporal.Instant, gatheringAt: Temporal.Instant): Temporal.Instant`; `computeSchedule(gatheringAt: Temporal.Instant, deadlineAt: Temporal.Instant): Schedule`.

Rules: default deadline = `min(gathering − 48h, now + (gathering − now)/2)`, or `now + (gathering − now)/2` if that minimum isn't after `now`, rounded down to the whole minute. 24h reminder = gathering − 24h (absolute). Morning reminder = 08:00 local on the gathering's day, or `null` if the gathering starts before 10:00 local. Check-in = 10:00 local the day after the gathering.

- [ ] **Step 1: Write the failing tests** in `plan-rules.test.ts`, one at a time (RED, GREEN, next). Inputs are `Temporal.Instant.from(...)` of literals; expected values are ISO literals:
  - `defaultDeadline` now `2026-11-09T18:00:00Z`, gathering `2026-11-14T18:00:00Z` → `2026-11-12T06:00:00Z` (AC1).
  - now `2026-11-11T18:00:00Z` → `2026-11-12T18:00:00Z` (AC2).
  - now `2026-11-13T18:00:00Z` → `2026-11-14T06:00:00Z` (AC3).
  - `localToInstant('2026-11-13','18:00')` → `2026-11-14T02:00:00Z` (AC4); `localToInstant('2026-11-14','10:00')` → `2026-11-14T18:00:00Z`.
  - `localToInstant('2027-03-14','02:30')` (nonexistent) and `localToInstant('2026-11-01','01:30')` (repeated) return an instant without throwing (Review Focus).
  - `computeSchedule(2026-11-14T18:00:00Z, 2026-11-12T06:00:00Z)` → `{ deadlineAt: '2026-11-12T06:00:00Z', reminder24At: '2026-11-13T18:00:00Z', reminderMorningAt: '2026-11-14T16:00:00Z', checkInAt: '2026-11-15T18:00:00Z' }` (AC7's schedule).
  - gathering `localToInstant('2026-11-14','09:30')` → `reminderMorningAt === null` (AC8).
  - fall-back day, gathering `2026-11-01T18:00:00Z` (10:00 PST) → `reminder24At '2026-10-31T18:00:00Z'`, morning `'2026-11-01T16:00:00Z'`, check-in `'2026-11-02T18:00:00Z'` (AC9).
  - spring-forward day, gathering `2027-03-14T17:00:00Z` (10:00 PDT) → `'2027-03-13T17:00:00Z'`, `'2027-03-14T15:00:00Z'`, `'2027-03-15T17:00:00Z'` (AC10).
- [ ] **Step 2: Run** `npx vitest run src/domain/plan-rules.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `time.ts` with `Temporal.PlainDateTime` → `toZonedDateTime(PLAN_TIME_ZONE, { disambiguation: 'compatible' })`, and `plan-rules.ts` per the rules; rounding down via `Instant.round({ smallestUnit: 'minute', roundingMode: 'floor' })`. Make `tsc` accept the `Temporal` types.
- [ ] **Step 4: Run** the tests and `npx tsc --noEmit` — Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `git add src/domain src/temporal-types.d.ts && git commit -m "feat: plan rules and time helpers"`

### Task 3: Publish form schema

**Covers:** AC1, AC4

**Files:**
- Create: `src/config.ts` (only the `CITIES` export for now; Task 8 adds the rest), `src/web/forms.ts`, `src/web/forms.test.ts`

**Interfaces:**
- Produces: `CITIES: readonly string[]` (the architecture's order); `publishFormSchema` (zod) whose output is `PublishForm = { city; area; timeWindow; format; venue; date: string; time: string; minimum: number; deadlineDate?: string; deadlineTime?: string; name; email; emailNormalized }`; `fieldMessages` rule table is Task 5's.

Rules (api-specification R3, §3.2): text fields trimmed, all-whitespace counts as empty; `city` ∈ `CITIES`; `area`, `timeWindow` 1–200; `format` 1–40; `venue` 1–120; `date` a real `YYYY-MM-DD`; `time` `HH:MM` 00:00–23:59; `minimum` an integer ≥ 2 that fits a Postgres integer; `deadlineDate` and `deadlineTime` both or neither (empty string counts as absent); `name` 1–80; `email` `z.email()`, 3–254, trimmed, with `emailNormalized` lowercased. `suggestionId` and `fromManageToken` are ignored (Story 1.7 and later).

- [ ] **Step 1: Write the failing tests** (one at a time): a valid body (coffee, Blue Bottle, Oakland, 2026-11-14, 10:00, minimum `'3'`, empty deadline fields) parses with `minimum === 3` and `deadlineDate === undefined`; `'  Ann@Example.TEST '` → `email 'Ann@Example.TEST'`, `emailNormalized 'ann@example.test'`; `minimum '1'`, `'2.5'`, `'3000000000'` fail; city `'Gotham'` fails; `date '2026-02-30'` fails; only `deadlineDate` given fails with the issue on `deadlineTime`; `CITIES[0] === 'San Francisco'` and `CITIES.length === 15`.
- [ ] **Step 2: Run** `npx vitest run src/web/forms.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `CITIES` and `publishFormSchema` in zod 4; export the inferred `PublishForm` type.
- [ ] **Step 4: Run** the tests — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/config.ts src/web/forms.ts src/web/forms.test.ts && git commit -m "feat: publish form schema"`

### Task 4: Test support and `publish()`

**Covers:** AC5, AC6, AC7, AC11

**Files:**
- Create: `src/db/client.ts`, `src/domain/plans.ts`, `src/domain/plans.test.ts`, `tests/support/fakes.ts`, `tests/support/db.ts`, `tests/support/builders.ts`
- Modify: `src/domain/events.ts` (replace the placeholder type with the database-schema's `EventData` union, add `appendEvent(tx, event)`), `src/web/app.ts` (widen `AppDeps.planWorkflows.start` to `(planId: string, schedule: Schedule) => Promise<void>`; keep the other boundaries)

**Interfaces:**
- Consumes: `newToken`, `computeSchedule`, `defaultDeadline`, `localToInstant`, `PublishForm`, schema tables.
- Produces:
  - `createDb(url: string): { db: Db; pool: pg.Pool }` — `drizzle(pool, { schema, casing: 'snake_case' })`.
  - `appendEvent(tx: Tx, event: { planId: string; commitId?: string } & EventData): Promise<void>`.
  - `publish(deps: Pick<AppDeps, 'db' | 'now' | 'planWorkflows'>, form: PublishForm): Promise<{ planId: string; publicToken: string; manageToken: string }>` — computes the gathering and the deadline (`defaultDeadline` when both deadline fields are absent, else `localToInstant`), then in `db.transaction`: insert plan (`state` open), creator commit (`isCreator: true`), events `plan.published` (`{ fromPlanId: null }`) and `commit.added` (`{ change: 'new', isCreator: true, activeCount: 1 }`, with `commitId`), then `await deps.planWorkflows.start(planId, schedule)`, then commit. A rejected `start` rolls the transaction back and rethrows.
  - `loadPlan(db: Db, manageToken: string): Promise<PlanView | null>` where `PlanView = { id; state; publicToken; manageToken; checkInToken; gatheringAt: string; commitDeadlineAt: string; count: number; commits: { isCreator: boolean; withdrawToken: string }[]; events: { type: string; data: Record<string, unknown> }[] }` (instants as ISO UTC strings; `count` = commits with `withdrawnAt` null).
  - `countPlans(db: Db): Promise<number>`.
  - `tests/support/fakes.ts`: `fakeEmail()` (records `calls`, can `failNext()`), `fakePlanWorkflows()` (records `startCalls: { planId; schedule }[]` and `signalCalls`, `failStart(error)`), `fakeSuggest(fixture?)`, `fixedClock(iso: string): () => Temporal.Instant`.
  - `tests/support/db.ts`: `testDb(): { db: Db; pool }` on `TEST_DATABASE_URL`; `resetDb(db)` truncating every table with `TRUNCATE … RESTART IDENTITY CASCADE`.
  - `tests/support/builders.ts`: `TEST_BASE_URL = 'https://calvin.test'`; `planForm(overrides?: Record<string,string>): Record<string,string>` (valid body: city Oakland, area Rockridge, timeWindow next weekend, format coffee, venue Blue Bottle, date 2026-11-14, time 10:00, minimum 3, empty deadline fields, name Ann, email ann@example.test); `testDeps(overrides?: Partial<AppDeps>): AppDeps & { fakes }` wiring `testDb()`, `fixedClock('2026-11-09T18:00:00Z')`, the fakes (`suggestPlanCall` from `fakeSuggest`, `sendEmail` from `fakeEmail`); `publishPlan(deps, overrides?)` that parses `planForm(overrides)` with `publishFormSchema` and calls `publish`.

- [ ] **Step 1: Write the failing tests** in `plans.test.ts` (`beforeEach(() => resetDb(db))`), one at a time:
  - "a published plan is open with its creator as only committer": `loadPlan` → `state 'open'`, `count 1`, `commits.length 1`, `commits[0].isCreator true`, events are `plan.published` and `commit.added` with data `{ change: 'new', isCreator: true, activeCount: 1 }` (AC5).
  - "tokens are 43 base64url characters and differ": publicToken, manageToken, checkInToken from `loadPlan` and the creator's withdrawToken each match `/^[A-Za-z0-9_-]{43}$/`; `new Set([...]).size === 4` (AC6).
  - "starts the workflow once with the schedule", published at `2026-11-09T18:00:00Z`: `fakes.planWorkflows.startCalls` has one call with `planId` equal to the published id and `schedule` `{ deadlineAt: '2026-11-12T06:00:00Z', reminder24At: '2026-11-13T18:00:00Z', reminderMorningAt: '2026-11-14T16:00:00Z', checkInAt: '2026-11-15T18:00:00Z' }` (AC7); `loadPlan` gives `gatheringAt '2026-11-14T18:00:00Z'`, `commitDeadlineAt '2026-11-12T06:00:00Z'`.
  - "a failed workflow start stores nothing": `failStart(new Error('temporal down'))`, `publishPlan` rejects, `countPlans(db) === 0` (AC11).
- [ ] **Step 2: Run** `npx vitest run src/domain/plans.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above. `start` is awaited inside the transaction callback after the inserts.
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc --noEmit` — Expected: PASS (including Story 1.1's tests).
- [ ] **Step 5: Commit** `git add src tests && git commit -m "feat: publish a plan"`

### Task 5: `POST /plans`

**Covers:** AC1, AC2, AC3, AC4, AC7, AC11

**Files:**
- Create: `src/web/routes/create.ts`, `src/web/routes/create.test.ts`, `src/web/views/system-error-page.ts`
- Modify: `src/web/app.ts` (`createApp(deps: AppDeps, config: { baseUrl: string })`, mount the routes, `app.onError`), `src/web/app.test.ts` (pass the config)

**Interfaces:**
- Consumes: `publishFormSchema`, `publish`, `loadPlan`, `countPlans`, builders and fakes from Task 4.
- Produces: route `POST /plans` (`zValidator('form', publishFormSchema, hook)`): on success `303` to `/m/<manageToken>/published`. Beyond the schema, the route checks (after parsing the gathering with `localToInstant` and the deadline with `defaultDeadline`/`localToInstant`): gathering > `deps.now()`, deadline > now, deadline < gathering. A failure of the schema or these checks re-renders the create page (Task 7's `createPage(values, errors)`) with `422` and the messages from api-specification §3.2, keeping every entered value; until Task 7 lands it renders through a stub `createPage` that Task 7 replaces. `systemErrorPage(): HtmlEscapedString` with "Something went wrong. Go back and try again." and a "Start over" link to `/`; `app.onError` renders it with 500 and calls `console.error('unexpected error', err.name)` only.

- [ ] **Step 1: Write the failing tests** in `create.test.ts` (`testDeps`, `createApp(deps, { baseUrl: TEST_BASE_URL })`, `app.request('/plans', { method: 'POST', body: new URLSearchParams(planForm(...)) })`; read back by following the `Location` manage token with `loadPlan`), one at a time:
  - published at `2026-11-09T18:00:00Z` → `303`, `Location` matches `^/m/[A-Za-z0-9_-]{43}/published$`, plan gathering `2026-11-14T18:00:00Z`, deadline `2026-11-12T06:00:00Z` (AC1).
  - clock `2026-11-11T18:00:00Z` → deadline `2026-11-12T18:00:00Z` (AC2); clock `2026-11-13T18:00:00Z` → `2026-11-14T06:00:00Z` (AC3).
  - `planForm({ deadlineDate: '2026-11-13', deadlineTime: '18:00' })` at `2026-11-09T18:00:00Z` → deadline `2026-11-14T02:00:00Z` (AC4).
  - `fakes.planWorkflows.startCalls` has exactly one call after a publish, with the schedule of AC7 (the route reaches `start` with the published plan's schedule).
  - `failStart` → `500`, body contains "Something went wrong. Go back and try again.", body contains no `at ` stack lines or `temporal down`, `countPlans === 0` (AC11).
  - 422 cases (each keeps entered values in the re-rendered body and shows its §3.2 message, and `countPlans === 0`): gathering in the past → "The gathering needs to be in the future."; deadline `2026-11-14` `18:00` (after the gathering) → "The decide-by time needs to be before the gathering."; deadline in the past → "The decide-by time needs to be in the future."; only `deadlineDate` → "Pick both a date and a time, or leave both empty."; `name: '<script>x</script> & Co'` with a bad email → the re-rendered body holds `&lt;script&gt;` and no raw `<script>x`.
- [ ] **Step 2: Run** `npx vitest run src/web/routes/create.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the route, the error page and the app wiring.
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc --noEmit` — Expected: PASS.
- [ ] **Step 5: Commit** `git add src && git commit -m "feat: POST /plans"`

### Task 6: Published screen

**Covers:** AC12, AC13

**Files:**
- Create: `src/web/routes/manage.ts`, `src/web/routes/manage.test.ts`, `src/web/views/published-page.ts`
- Modify: `src/web/app.ts` (mount the route)

**Interfaces:**
- Consumes: `loadPlan`, `publishPlan`, `TEST_BASE_URL`.
- Produces: `GET /m/:token/published` — a token not matching `^[A-Za-z0-9_-]{43}$` or not found → the existing `notFoundPage` with 404; otherwise `publishedPage({ publicLink: string, manageLink: string })` (pure view; the route builds `${baseUrl}/p/${publicToken}` and `/m/${manageToken}`) with "Your plan is ready to share", a read-only link box with a **Copy** button (no script in this story; `create.js` is a later story), the "We couldn't email you your private link. Bookmark the link below to manage the plan." meta line (see Rulings) and a quiet **Manage your plan** link. `noindex` meta tag and generic OG tags in the layout for this page.

- [ ] **Step 1: Write the failing tests** (`manage.test.ts`):
  - "shows the share link and the manage link": publish, `GET /m/<manageToken>/published` → `200`, body contains "Your plan is ready to share", `https://calvin.test/p/<publicToken>` and `href="/m/<manageToken>"` with text "Manage your plan".
  - "unknown token is 404": a fresh `newToken()` that matches no plan → `404` and body contains the not-found copy "We can't find that plan.".
  - "malformed token is 404 without a database query": `deps` with `db` replaced by a Proxy that throws on any property access; `GET /m/short/published` and `/m/${'a'.repeat(44)}/published` → `404` (AC13).
- [ ] **Step 2: Run** `npx vitest run src/web/routes/manage.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the route and view; the token check is one shared helper `isToken(value: string): boolean` in `src/domain/tokens.ts` (add a one-line test beside Task 1's).
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc --noEmit` — Expected: PASS.
- [ ] **Step 5: Commit** `git add src && git commit -m "feat: published screen"`

### Task 7: Create page and base stylesheet

**Covers:** AC1

**Files:**
- Create: `src/web/views/create-page.ts`, `src/web/views/create-page.test.ts`, `public/app.css`
- Modify: `src/web/views/layout.ts` (stylesheet link `/static/app.css`), `src/web/routes/create.ts` (`GET /`), `src/web/app.ts` (serve `/static/*` from `public/` with `serveStatic` from `@hono/node-server/serve-static`, `Cache-Control: public, max-age=86400`)

**Interfaces:**
- Produces: `createPage(values: Record<string,string>, errors: Record<string,string>, cities?: readonly string[]): HtmlEscapedString` — the fallback-shape form (UX mockup 1c) posting to `/plans`: city `<select>` over `CITIES` in order with an unselected blank first option, rough area, rough time, format, venue, date (`type=date`), time (`type=time`), minimum (default `3`), Decide by (date + time, empty), "You're the first one in", your name, your email, **Publish plan**; each field error under its field with `aria-describedby`. `GET /` renders it with empty values. `public/app.css` holds the UX §4 tokens as custom properties (`--bg`, `--surface`, `--text`, `--text-2`, `--muted`, `--border`, `--border-strong`, `--accent`, `--accent-hover`, `--accent-tint`, `--on`, `--on-tint`, `--error`, `--s1`–`--s6`) with a `prefers-color-scheme: dark` override block, the system-rounded font stack, one centred column `max-width: 440px`, and 16px inputs.

- [ ] **Step 1: Write the failing tests** in `create-page.test.ts` (views seam) and one route test: `createPage({}, {})` renders the city options in the architecture's order with no `selected` option, `minimum` value `3`, empty Decide by inputs, the heading "You're the first one in" and a **Publish plan** button; `createPage({ name: '<b>' }, {})` escapes the value; with `errors: { name: 'Add your name.' }` the message appears and the input has `aria-describedby`. Route test (`create.test.ts`): `GET /` → `200`, text/html, body contains `/static/app.css`; `GET /static/app.css` → `200` and body contains `prefers-color-scheme: dark` and `#FBF7F2` and `#1E1A17`.
- [ ] **Step 2: Run** `npx vitest run src/web` — Expected: FAIL.
- [ ] **Step 3: Implement** the view, stylesheet, `GET /` and the static mount (replacing Task 5's stub `createPage`).
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc --noEmit` — Expected: PASS.
- [ ] **Step 5: Commit** `git add src public && git commit -m "feat: create page and stylesheet"`

### Task 8: Config, Temporal client and worker, entry point

**Covers:** AC7 (the real `planWorkflows` that the fake stands in for)

No automated tests (test-strategy: `config.ts`, `client.ts`, `worker.ts`, `main.ts` have none at poc); this task is checked by hand, as below.

**Files:**
- Create: `src/temporal/workflows.ts`, `src/temporal/client.ts`, `src/temporal/worker.ts`, `src/main.ts`, `.env.example`
- Modify: `src/config.ts`, `package.json` (add a `start` script `node src/main.ts`)

**Interfaces:**
- `loadConfig(env: NodeJS.ProcessEnv): Config` with `Config = { baseUrl; port: number; databaseUrl; anthropicApiKey; anthropicModel; resendApiKey; emailFrom; temporalAddress; temporalNamespace }`, zod-validated per the architecture's variable table (`PORT` default 8080, `ANTHROPIC_MODEL` default `claude-sonnet-5-5`, `TEMPORAL_API_KEY` optional and left to envconfig). On failure it throws an `Error` whose message is `Invalid environment: ` plus the variable names only (from the zod issue paths) — never a value.
- `planWorkflow(input: { planId: string; deadlineAt: number; reminder24At: number; reminderMorningAt: number | null; checkInAt: number }): Promise<void>` in `workflows.ts`, importing only `@temporalio/workflow`/types; the body is empty (no timers yet, Epic 3).
- `createPlanWorkflows(client: Client): AppDeps['planWorkflows']` in `client.ts`: `start(planId, schedule)` calls `client.workflow.start(planWorkflow, { workflowId: 'plan-' + planId, taskQueue: 'calvin', args: [{ planId, ...epoch ms of each schedule ISO string }] })`; `signal` is a stub that throws "not available yet" (no signal route in this story). `connectTemporalClient(): Promise<Client>` uses `loadClientConnectConfig()` and `Connection.connect(...)`.
- `startWorker(): Promise<{ run(): Promise<void>; shutdown(): void }>` in `worker.ts`: `Worker.create({ connection (from loadClientConnectConfig), taskQueue: 'calvin', workflowsPath: fileURLToPath(new URL('./workflows.ts', import.meta.url)) })`.
- `main.ts`: `loadConfig(process.env)`, `createDb`, `Temporal.Now.instant` as `now`, stubbed `suggestPlanCall`/`sendEmail` (Rulings), `createApp(deps, { baseUrl })` served with `@hono/node-server` `serve({ fetch, port })`, and the worker running alongside; on SIGINT/SIGTERM it shuts down both. A config error prints the message and exits 1.

- [ ] **Step 1: Implement** the files above. `.env.example` lists the variable names only, no values.
- [ ] **Step 2: Run** `npx tsc --noEmit` and `npx vitest run` — Expected: no type errors, all tests PASS.
- [ ] **Step 3: Manual check, config** (record the output in the PR description): `env -u DATABASE_URL node src/main.ts` with the other variables set to dummy values → exit code 1, the message names `DATABASE_URL`, and no variable's value appears in the output.
- [ ] **Step 4: Manual check, run** (the operator, after the merge): with `temporal server start-dev` running and a real `.env`, `node --env-file=.env src/main.ts` on Node 26 → `curl -i localhost:8080/` returns 200 and the worker appears polling task queue `calvin` (`temporal task-queue describe --task-queue calvin`); then publishing through the form starts workflow `plan-<planId>` (visible in the UI at `localhost:8233`). If the worker can't run on Node 26 (bundling `workflows.ts` or the native core), the story halts for the operator, as the story says.
- [ ] **Step 5: Commit** `git add src package.json .env.example && git commit -m "feat: config, temporal client and worker, entry point"`

---

## Self-review notes

- AC order: 1–4 deadlines, 5 read-back, 6 tokens, 7 workflow start schedule, 8 no morning reminder, 9 fall-back, 10 spring-forward, 11 start failure, 12 published screen, 13 bad token.
- Coverage: AC1–4 Tasks 2, 5; AC5 Task 4; AC6 Tasks 1, 4; AC7 Tasks 4, 5, 8; AC8–10 Task 2; AC11 Tasks 4, 5; AC12–13 Task 6. Shared fakes are Task 4, config and entry point Task 8, the stylesheet Task 7.
