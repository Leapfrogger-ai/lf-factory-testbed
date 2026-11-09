# The trial metrics run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One integration test runs every query in `specs/calvin-5/database-schema.md`'s "Trial metric queries" section, as written, against the test database seeded through the app's own code paths, and checks the results.

**Architecture:** A support helper reads the document, takes the `sql` block under "## Trial metric queries", strips `--` comment lines and splits it into statements. `tests/trial-metrics.test.ts` seeds scenarios with `publishPlan`, `commit`, `resolveDeadline`, `recordCheckInAnswer`, `sendOnce` and the activities, runs the statements through `db.execute(sql.raw(...))`, and asserts hand-worked literals. A query that fails is fixed in the document and the test together. The app's event and column writes were audited against FR029 and all exist (see Rulings), so no `src/` change is planned.

**Tech Stack:** TypeScript on Node 26, Drizzle (`sql.raw`), Vitest with the worktree's Postgres.

**Spec:** .factory/story.md (story #257)

## Global Constraints

- Tests verify behaviour through public interfaces, at the seams `specs/calvin/test-strategy.md` names — tests that reach inside break on every refactor.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- Plan and commit state changes only in `src/domain/plans.ts`, inside a transaction that locks the plan row and appends its event through `appendEvent` — one source of truth, and commit races settle on the row lock.
- Every email is sent through `sendOnce`, with its payload built only from stored data — that's what makes each email go out exactly once and a retry identical.
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed in.
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities.
- No secret is read, stored, logged or committed other than as the architecture's Secrets table says (env vars from Fly secrets or a gitignored `.env`; never in `fly.toml`, the Dockerfile, the repo, a log line or a CI command line; `.env.example` holds names only) — a leaked secret can't be taken back.
- The plan's state (open, confirmed, called off), its commits and its event log live in Postgres.
- every email is recorded in an `email_sends` ledger with a unique `(commit_id, kind)` key.
- | Test database | `FACTORY_DB_NAME` on that server (default `calvin_test`) |
- | App port (manual dev runs only; tests use `app.request()`) | `FACTORY_PORT_BASE + 0` (default 8080) |
- | Postgres server | the test run's own, started by `embedded-postgres` on `127.0.0.1:${FACTORY_PORT_BASE + 2}` (default 20002), user `postgres`, password `calvin`, data in the worktree's `.factory/pgdata` |
- It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database.
- Each integration file resets the database before each test.
- `build` is the type check, since Node runs `.ts` directly.

Binding: CODING_STANDARDS.md, docs/adr/0002-postgres-owns-state-temporal-owns-time.md, specs/calvin-5/test-strategy.md

## Review Focus

- A `;` inside a `--` comment in the document's SQL block ("-- Emails sent per kind; and on-time check…") would split a statement in two: the helper strips comment lines before splitting, and Task 1 pins the statement count at 7.
- A query added to the document later but not tested: Task 1's count assertion fails until the test covers it.
- Empty tables: `share_rate` over zero plans is `nullif`-guarded and returns null, not an error (Task 2).
- pg returns `count(*)`/`bigint` and `avg()` numerics as strings: assertions convert with `Number(...)`, so a correct query can't fail on type (Tasks 2–4).

## File Structure

- Create `tests/support/trial-metrics.ts`: reads the document, returns statements.
- Create `tests/trial-metrics.test.ts`: all scenarios.
- Modify `specs/calvin-5/database-schema.md` (Trial metric queries) and, only if a test shows a gap, `src/domain/*.ts`.

### Task 1: Every documented query runs

**Covers:** AC5

**Files:**
- Create: `tests/support/trial-metrics.ts`
- Create: `tests/trial-metrics.test.ts`
- Modify (only if a query fails): `specs/calvin-5/database-schema.md`

**Interfaces:**
- Produces:
  - `trialQueries(): string[]` — the statements of the first ```` ```sql ```` block after the heading `## Trial metric queries` in `specs/calvin-5/database-schema.md` (path resolved from `import.meta.url`), `--` comment lines removed, split on `;`, trimmed, empty ones dropped.
  - `trialQuery(marker: string): string` — the one statement containing `marker`; throws unless exactly one matches.
  - `runQuery(db: Db, marker: string): Promise<Record<string, unknown>[]>` in the test file: `(await db.execute(sql.raw(trialQuery(marker)))).rows`.
- Markers used by later tasks: `share_rate`, `was_confirmed`, `edited_rate`, `FROM email_sends`, `create_to_link`, `p95_ms`, `lateness`.

Fixture (worked): at clock `2026-11-09T18:00:00Z` the builder's default plan has minimum 3, gathering 2026-11-14 10:00 local (18:00Z) and, with no deadline given, deadline `2026-11-12T06:00Z`. Seeded database for this test: (a) a failed suggestion `recordSuggestion(deps, input, { outcome: 'failed', failureReason: 'timeout', latencyMs: 20000 })`; (b) an ok suggestion from `suggest(input, { suggestPlanCall: async () => loadFixture('good'), now: deps.now })` recorded with `previousSuggestionId` = (a)'s id (copy the `okSuggestion` pattern from `src/domain/plans.test.ts`, with `input = { city: 'Oakland', area: 'Rockridge', timeWindow: 'next weekend, morning' }`); (c) a plan published from (b) with the `fromSuggestion` form values in that file; (d) a second plan, published with builder defaults, then `resolveDeadline(db, planId)` → called off at its deadline.

- [ ] **Step 1: Write the failing test** `it('runs every query in the Trial metric queries section without error')`: seed (a)–(d); `expect(trialQueries()).toHaveLength(7)`; for each statement `await expect(db.execute(sql.raw(statement))).resolves.toBeDefined()`; then `expect(await runQuery(db, 'create_to_link'))` has one row with `suggestions_seen` equal to `'2'` (bigint string) and `expect(await runQuery(db, 'lateness'))` has one row (plan (d)).
- [ ] **Step 2: Run** `npx vitest run tests/trial-metrics.test.ts`. Expected: FAIL (helper module missing).
- [ ] **Step 3: Implement** `trialQueries` and `trialQuery` in `tests/support/trial-metrics.ts` with `readFileSync`; locate the section by the heading text, take the first `sql` fence after it.
- [ ] **Step 4: Run** the same command. Expected: PASS, or a Postgres error naming a failing query. A failing query is fixed in `database-schema.md` in the same commit (the test runs the text as written), then re-run until PASS.
- [ ] **Step 5: Mutate to show it can fail:** temporarily change `nullif(count(*), 0)` in the document's share-rate query to `nullif(cnt(*), 0)`, see the test FAIL, then restore the document.
- [ ] **Step 6: Run** `npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 7: Commit** `git add tests/support/trial-metrics.ts tests/trial-metrics.test.ts specs/calvin-5/database-schema.md && git commit -m "Run every trial metric query against the real schema"`

### Task 2: Share rate and edited rate

**Covers:** AC1, AC3

**Files:**
- Modify: `tests/trial-metrics.test.ts`
- Modify (only if a query is wrong): `specs/calvin-5/database-schema.md`

**Interfaces:**
- Consumes: `runQuery`, `publishPlan`, `commit`, `commitFormSchema` (`src/web/forms.ts`), `okSuggestion` pattern from Task 1.

Fixtures (worked): *Share* — plan A: `publishPlan(deps, { name: 'Ann' })`, then `commit(deps, publicToken, commitFormSchema.parse({ name: 'Mia', email: 'mia@example.test' }))` (2 of 3, still open at `2026-11-09T18:00:00Z`); plan B: `publishPlan(deps, { name: 'Bea', email: 'bea@example.test' })`, creator only. A has a non-creator commit, B has none: 1 of 2. *Edited* — two ok suggestions (each through the `okSuggestion` pattern); plan C published from the first with the `fromSuggestion` values unchanged (`suggestion_edited` false, pinned by `plans.test.ts`'s AC8 test); plan D from the second with `{ ...fromSuggestion, venue: 'Another Cafe' }` (true, as that file's venue-change test).

- [ ] **Step 1: Write the failing test** `it('share rate is 0.5 for one shared plan and one creator-only plan (AC1)')`: `Number(rows[0].share_rate)` is `0.5` and `rows` has length 1. Also `it('share rate is null with no plans')`: after `resetDb`, `rows[0].share_rate` is `null`.
- [ ] **Step 2: Run** `npx vitest run tests/trial-metrics.test.ts -t "share rate"`. Expected: FAIL only if the query is wrong; otherwise PASS first time, so apply the mutation in Step 3.
- [ ] **Step 3: Mutate to show it can fail:** in the test's seed, skip Mia's `commit` and see the AC1 test FAIL (rate 0), then restore.
- [ ] **Step 4: Write the failing test** `it('edited rate is 0.5 for one unchanged and one edited published suggestion (AC3)')`: `Number(rows[0].edited_rate)` is `0.5`.
- [ ] **Step 5: Run** `npx vitest run tests/trial-metrics.test.ts -t "edited rate"`. Expected: PASS or fix the query in the document; if it passes first time, mutate the seed (publish D with unchanged `fromSuggestion`) to see rate 0, then restore.
- [ ] **Step 6: Commit** `git add tests/trial-metrics.test.ts specs/calvin-5/database-schema.md && git commit -m "Prove the share-rate and edited-rate queries"`

### Task 3: Outcomes per plan

**Covers:** AC2

**Files:**
- Modify: `tests/trial-metrics.test.ts`
- Modify (only if the query is wrong): `specs/calvin-5/database-schema.md`

**Interfaces:**
- Consumes: `runQuery`, `recordCheckInAnswer(deps, checkInToken, question, answer)` (`src/domain/plans.ts`), `resolveDeadline(db, planId)`.

Fixture (worked), clock `2026-11-09T18:00:00Z`, minimum 3: plan 1 `publishPlan(deps, { name: 'Ana', email: 'ana@example.test' })` (creator counts as 1), then `commit` Mia and Raj (`@example.test`) → 3 of 3, confirmed. Answer `recordCheckInAnswer(deps, checkInToken, 'happened', true)` and `(…, 'attended', false)`; `checkInToken` is not returned by `publishPlan`, so read it from `loadPlan(db, manageToken)` (its `checkInToken` field). Plan 2 is published after plan 1 with builder defaults and `resolveDeadline(db, planId)` (creator only, 1 < 3 → called off, reason `deadline`). The query orders by `created_at`, and the two publishes are separate transactions, so plan 1 is first.

- [ ] **Step 1: Write the failing test** `it('outcomes: a confirmed plan with answers, then a plan called off at its deadline (AC2)')`: two rows. Row 0: `state` `'confirmed'`, `called_off_reason` `null`, `was_confirmed` `true`, `Number(count)` `3`, `minimum` `3`, `happened` `1`, `creator_attended` `0`. Row 1: `state` `'called_off'`, `called_off_reason` `'deadline'`, `was_confirmed` `false`, `Number(count)` `1`, `minimum` `3`, `happened` `null`, `creator_attended` `null`.
- [ ] **Step 2: Run** `npx vitest run tests/trial-metrics.test.ts -t "outcomes"`. Expected: PASS, or a query error / wrong column fixed in the document; if it passes first time, mutate by dropping the `attended` answer from the seed and see `creator_attended` come back `null` (FAIL), then restore.
- [ ] **Step 3: Commit** `git add tests/trial-metrics.test.ts specs/calvin-5/database-schema.md && git commit -m "Prove the outcomes query"`

### Task 4: Emails per kind and one event per type

**Covers:** AC4, AC6

**Files:**
- Modify: `tests/trial-metrics.test.ts`
- Modify (only if a test shows the app doesn't write an event or column): `src/domain/plans.ts`, `src/email/send.ts`, `src/domain/events.ts`

**Interfaces:**
- Consumes: `sendOnce(deps: { db; sendEmail; baseUrl }, kind, plan, commit, activeCommits?)` (`src/email/send.ts`), `loadSendTarget(db, planId): Promise<{ plan; commit }>` and `loadSendTargets(db, planId)` (`src/domain/plans.ts`), `createActivities({ db, sendEmail, baseUrl })` with `sendToCommitters(planId, kind)` and `sendCheckIn(planId)` (`src/temporal/activities.ts`), `TEST_BASE_URL` and `testDeps()` whose `fakes.email.calls` records every payload (its `tags` carry `{ name: 'kind', value }`).

Fixture (worked), same two plans as Task 3 (plan 1 confirmed with Ana, Mia, Raj; plan 2 called off at its deadline with only its creator): `manage_link` via `sendOnce` to each creator (`loadSendTarget`) = 2 emails; `sendToCommitters(plan1, 'confirmed')` = 3; `sendCheckIn(plan1)` = 1; `sendToCommitters(plan2, 'not_this_time')` = 1. Expected counts: `check_in` 1, `confirmed` 3, `manage_link` 2, `not_this_time` 1 (7 emails; `fakes.email.calls` has length 7).

- [ ] **Step 1: Write the failing test** `it('emails per kind match the emails sent (AC4)')`: rows sorted by `kind`, mapped to `[kind, Number(count)]`, equal `[['check_in', 1], ['confirmed', 3], ['manage_link', 2], ['not_this_time', 1]]`; and the same counts tallied from `fakes.email.calls[].payload.tags` (the `kind` tag) equal the rows, so the expectation has an independent source.
- [ ] **Step 2: Run** `npx vitest run tests/trial-metrics.test.ts -t "emails per kind"`. Expected: PASS or fix; if it passes first time, mutate by not calling `sendCheckIn` and see the `check_in` row vanish (FAIL), then restore.
- [ ] **Step 3: Write the failing test** `it('lists one event of each type over a plan's life, each with a timestamp (AC6)')`: seed plan 1 as in Task 3 with one `sendOnce` of `manage_link` to its creator and the check-in answer `happened` = yes. Select `type, created_at` from `events` for that plan ordered by `id` with `db.execute(sql\`SELECT type, created_at FROM events WHERE plan_id = ${planId} ORDER BY id\`)`; `type` list equals `['plan.published', 'commit.added', 'commit.added', 'commit.added', 'plan.confirmed', 'email.sent', 'check_in.answered']`; every `created_at` is a `Date`. (This is a SQL read on purpose: the events table is this story's interface, as the ledger is the Send ledger seam's.)
- [ ] **Step 4: Run** `npx vitest run tests/trial-metrics.test.ts -t "one event"`. Expected: PASS. A missing type means the app doesn't write what FR029 names: add the write in the domain function that changes that state, through `appendEvent`, and extend `eventDataSchema` if it's a new type. If it passes first time, mutate `appendEvent` in the `check_in.answered` call in `recordCheckInAnswer` (comment it out), see FAIL, restore.
- [ ] **Step 5: Run** `npx vitest run` and `npx tsc --noEmit`. Expected: all PASS, no type errors.
- [ ] **Step 6: Commit** `git add tests/trial-metrics.test.ts && git commit -m "Prove the emails-per-kind query and the lifecycle events"` (add any `src/` file changed in Step 4).

## Rulings

Ruling: The test lives at `tests/trial-metrics.test.ts` with its helper in `tests/support/trial-metrics.ts` — it spans several seams (Plan operations, Send ledger) and test-strategy puts shared helpers in `tests/support/` — a reviewer may prefer it next to `plans.test.ts`; moving it is a rename.
Ruling: The test reads the SQL from `specs/calvin-5/database-schema.md` at run time rather than copying it — the story says "as the document writes them", and a copy would let the document rot — it costs a coupling to the document's heading and fence, which Task 1 pins with the count of 7.
Ruling: No `src/` change is planned. Audit of FR029 against the code: `plans`/`commits` timestamps, `plan.published`, `commit.added`, `commit.withdrawn`, `plan.confirmed`, `plan.called_off`, `email.sent`, `check_in.answered` events, `suggestions` rows and `plans.suggestion_edited` are all written by `src/domain/plans.ts`, `src/domain/suggestions.ts` and `src/email/send.ts`. Task 4 Step 3 is the check; if it finds a gap, the build session writes it — wrong only if an unaudited column (none known) is missing.
Ruling: The share-rate query counts any non-creator `commits` row, withdrawn or not, as written in the document; no AC says otherwise, so the document stays as written — if the operator wants active-only, it is a one-line change to the document and a new test.
Ruling: `count(*)` and `avg()` come back from `pg` as strings, so assertions use `Number(...)` — it keeps the document's SQL unchanged — it costs nothing if wrong.
Ruling: The "example plan" in AC2 is built with the builder defaults (minimum 3, creator "Ana", plus Mia and Raj) because the story names no other fixture — a different example only changes literals.
