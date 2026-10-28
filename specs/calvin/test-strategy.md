# Test Strategy: calvin

**Maturity**: poc
**Date**: 2026-10-27
**Inputs**: [brief.md](./brief.md), [PRD.md](./PRD.md), [architecture.md](./architecture.md), [database-schema.md](./database-schema.md), [api-specification.md](./api-specification.md), ADRs [0001](../../docs/adr/0001-temporal-workflow-per-plan.md)–[0005](../../docs/adr/0005-capability-tokens-stored-in-plaintext.md)

Every test is written test-first, one vertical slice at a time (TDD per task). Vitest 5 runs every test. calvin has no build step, so the build command is the type check.

---

## Boundaries are passed in

Tests can only replace a boundary that the code receives as an argument, so the code is wired like this. Reviewers check it:

- `createApp(deps)` in `src/web/app.ts` builds the Hono app from `deps = { db, now, suggestPlanCall, sendEmail, planWorkflows }`. `src/main.ts` is the only place that builds the real ones.
- `createActivities(deps)` in `src/temporal/activities.ts` gets `{ db, sendEmail }`.
- Each external operation is its own function, never a generic client:
  - `suggestPlanCall(request) → Anthropic Message` wraps the single `messages.create` call.
  - `sendEmail(payload, idempotencyKey) → { id }` wraps `resend.emails.send` and turns its `{ data, error }` into a return value or a thrown error.
  - `planWorkflows.start(planId, schedule)` and `planWorkflows.signal(planId, signal, arg)` wrap the Temporal client.
- `now: () => Temporal.Instant` is the only clock that routes and `domain/` read. `plan-rules.ts` takes the instant as an argument (architecture, Code Organization).
- `src/db/migrate.ts` reads only `DATABASE_URL`, not the whole `config.ts`, so it runs in tests and setup without the app's secrets.

---

## Seams

| Seam | Module or surface | Catches | Misses |
|------|-------------------|---------|--------|
| Plan rules | `src/domain/plan-rules.ts`, `src/domain/time.ts` exports | Default deadline, the schedule's UTC instants (24h reminder, 08:00 morning reminder or none, 10:00 check-in), the 6h morning-skip rule, minimum and deadline validity, DST edges, UX §8.8 display formats | Anything stored or sent |
| Tokens | `src/domain/tokens.ts` `newToken()` | Length, base64url alphabet, uniqueness across calls | Whether routes use them |
| Form schemas | `src/web/forms.ts` zod schemas | Trimming, email normalisation, name length, minimum ≥ 2, city in `CITIES`, date/time parsing | How errors render |
| Views | `src/web/views/*.ts` exported functions | Rendering rules that are awkward to reach through a route: HTML escaping of names and venues, first-word names capped at 16 chars, seat rows, state pill, no email address on any page | Routing, status codes, data loading |
| Email templates | `src/email/templates.ts`, one function per kind | Subject and text for each of the 6 kinds (UX §8.9), and the right link (withdraw, manage, check-in) in each | Whether and when it is sent |
| Suggestion | `src/suggest/suggest.ts` `suggest(input, deps)` | Request shape (model, tools, `max_uses`, `user_location`, no forbidden params), parsing a `propose_plan` call, fallback on no tool call, `pause_turn`, `refusal`, `max_tokens`, error or timeout | Whether real venues are real, real latency (NFR001) |
| Plan operations | `src/domain/plans.ts` exports, with the worktree's Postgres | Publish, commit (upsert on email, confirm at the minimum, FR015 rejections), withdraw, call off, `resolveDeadline`, the events each appends, the row lock settling a commit race | HTTP, emails |
| Send ledger | `src/email/send.ts` `sendOnce()`, with the worktree's Postgres | One email per `(commit, kind)` across repeated calls, the idempotency key, identical payload on retry, `email.sent` event, retryable vs non-retryable errors | Real delivery |
| Routes | `createApp(deps).request()` for every route in api-specification.md | Status codes, 303 redirects and their notices, 404 for bad or malformed tokens, 422 re-render with entered values kept, CSRF rejection, `noindex` and security headers, the user-visible HTML, which emails and signals each route triggers | Real Temporal, real email, a browser |
| Plan workflow | `planWorkflow` run by `TestWorkflowEnvironment.createTimeSkipping()` with `createActivities(...)` and the worktree's Postgres | The whole time-driven lifecycle: deadline confirm or call-off, confirmation on signal, late-commit confirmation, reminders at the right instants, morning skip, call-off path, check-in, nothing sent to withdrawn committers, each email once | Temporal Cloud specifics, Node-to-Cloud connection |

No test is written at a seam this table doesn't name. `src/main.ts`, `src/config.ts`, `src/temporal/client.ts`, `src/temporal/worker.ts`, `src/log.ts`'s transport and `public/create.js` have no automated tests at poc. The first story that touches each checks it by hand and records how in its plan. The one exception is the logger's redaction rule: it's tested through the Routes seam, by asserting that no logged line contains a token or an email address.

---

## Layers

| Layer | Seams | Tool | Runs in CI |
|-------|-------|------|------------|
| Unit | Plan rules, Tokens, Form schemas, Views, Email templates, Suggestion | Vitest; no network, no database, no timers | yes |
| Integration | Plan operations, Send ledger, Routes, Plan workflow | Vitest + the worktree's Postgres 17 database; `@temporalio/testing` time-skipping server for the workflow | yes |

There are no end-to-end tests at poc. The trial itself is the end-to-end check.

Where tests sit: unit tests next to their source as `*.test.ts`. Integration tests for Plan operations, Send ledger and Routes also sit next to their source (`plans.test.ts`, `send.test.ts`, `routes/plan.test.ts`). Plan workflow tests sit in `tests/workflow/*.test.ts`. Shared test helpers sit in `tests/support/`, recorded responses in `tests/fixtures/`.

---

## Real vs mocked

| Dependency | Unit | Integration | Why |
|------------|------|-------------|-----|
| Postgres | not used | real: Postgres 17, started for the test run by `embedded-postgres` | The commit race, upserts, unique ledger keys and CHECK constraints are the behaviour; a fake can't show them |
| Anthropic API | faked `suggestPlanCall`, returning recorded responses | faked `suggestPlanCall` (Routes) | External, paid, slow and non-deterministic. Real latency is measured by hand in the first suggestion story, outside `test` |
| Resend | faked `sendEmail` that records calls | faked `sendEmail` that records calls and can be told to fail once, or fail non-retryably | External, and test sends use the 100/day quota |
| Temporal (Routes) | — | faked `planWorkflows` that records `start` and `signal` calls, and can be told to fail | External service; the route only has to call it correctly and handle failures (ADR 0002) |
| Temporal (Plan workflow) | — | real: the time-skipping test server | Timers and signals are the behaviour under test |
| Clock | fixed instant passed in | fixed `now()` in `deps`; Temporal's skipped time in workflow tests | Deadlines and schedules must be reproducible |
| Randomness (tokens, UUIDs) | real | real | Tests read tokens back from what publish returns, never predict them |
| Project modules (`domain/`, `email/`, activities, views) | real | real | Never mocked |

Rules for reviewers:
- Mock only at system boundaries, the four `deps` functions above plus the clock. A test never mocks a project module, `vi.mock`s a project file, or replaces a domain function with a spy.
- No implementation-coupled tests. Test through the seam's interface. A route test checks the response and the recorded boundary calls, not the database. A Plan operations test reads state back through `domain/plans.ts` functions, not with its own SQL. The one exception is the Send ledger seam: its test may count `email_sends` rows, because the ledger is its interface.
- No tautological tests. Expected values come from an independent source: a literal worked out by hand, the PRD, the UX spec or api-specification.md. An expected schedule instant is written as an ISO literal (`"2026-11-08T16:00:00Z"`), never computed with `time.ts`.
- Vertical slices: one failing test, then the code that passes it, then the next test.
- Every DST-sensitive rule has a test on the 2026-11-01 (fall back) and 2027-03-14 (spring forward) transitions in `America/Los_Angeles`.
- Each route's outcome table in api-specification.md is that route's test list.

---

## Fixtures and seed data

- **No seed data.** Every test builds only what it uses. The database starts empty apart from migrations.
- **Builders** in `tests/support/builders.ts`: `planForm(overrides)` returns a valid publish form body, and `publishPlan(deps, overrides)` publishes through `domain/plans.ts` and returns the plan with its tokens. Commits, withdrawals and call-offs in a test's setup also go through `domain/plans.ts`, never through raw inserts.
- **Fakes** in `tests/support/fakes.ts`: `fakeEmail()`, `fakePlanWorkflows()`, `fakeSuggest(fixture)` and `fixedClock(iso)`. Each one records its calls for assertions. `testDeps(overrides)` puts them together with the test database.
- **Database** in `tests/support/db.ts`: `testDb()` connects to `TEST_DATABASE_URL`. `resetDb()` truncates every table (`TRUNCATE … RESTART IDENTITY CASCADE`) and runs in each integration file's `beforeEach`.
- **Recorded Anthropic responses** in `tests/fixtures/anthropic/*.json`: a good `propose_plan` call, a response with no tool call, `pause_turn`, `refusal` and `max_tokens`. The first suggestion story captures the good response once from a real call, by hand, and removes anything personal. It builds the others by editing that one.
- **Test addresses** are `@example.test`. The fakes never send them anywhere.

---

## Worktree isolation

| Resource | Taken from |
|----------|-----------|
| App port (manual dev runs only; tests use `app.request()`) | `FACTORY_PORT_BASE + 0` (default 8080) |
| Temporal time-skipping test server | `FACTORY_PORT_BASE + 1` (default: a free port chosen by the SDK) |
| Postgres server | the test run's own, started by `embedded-postgres` on `127.0.0.1:${FACTORY_PORT_BASE + 2}` (default 20002), user `postgres`, password `calvin`, data in the worktree's `.factory/pgdata` |
| Test database | `FACTORY_DB_NAME` on that server (default `calvin_test`) |

`TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database.

**Why not Docker:** the factory runs a story's commands in a sandbox with its own network, so a Postgres on the host's `127.0.0.1` (a Docker container) can't be reached from a story's tests, and the sandbox may not reach the Docker socket. A Postgres started inside the test run can. This was checked in the factory's sandbox on 2026-10-27: `embedded-postgres@17.10.0-beta.17` started Postgres 17.10, and two connections saw each other's row lock.

**Creating it:** `setup` installs dependencies. Vitest's `globalSetup` (`tests/support/global-setup.ts`) starts Postgres with `embedded-postgres` (`persistent: false`, data in `.factory/pgdata`, and `postgresFlags: ['-c', 'unix_socket_directories=']` so it listens on TCP only: the sandbox's `/tmp` is read-only, and a socket path in the worktree would be too long). It then creates the worktree's database and applies every migration in `drizzle/` with `src/db/migrate.ts`, and its teardown stops the server. This runs on every test run, so a story that adds a migration doesn't need `setup` again. `embedded-postgres` is a dev dependency pinned exactly to `17.10.0-beta.17`; its postinstall script isn't needed, so npm's skipping it is fine. If the global setup fails, Vitest 5 can report "No test files found": read the error printed after it.

**Within a run:** `fileParallelism: false` makes test files run one after another. The time-skipping server's clock is global, so workflow tests must run serially anyway (research/temporal-typescript-sdk.md). Each integration file resets the database before each test.

**Dropping it:** the teardown stops the server and `persistent: false` removes its data, so every test run starts from an empty database. Several worktrees can run tests at once: each has its own server on its own port.

**First run needs network:** `createTimeSkipping()` downloads the Temporal test server binary on its first use and caches it. A worktree that can't reach Temporal's download host fails the workflow tests on the first run only.

---

## Commands

| Command | Exact command |
|---------|---------------|
| test | `npx vitest run` |
| build | `npx tsc --noEmit` |
| setup | `if [ -f package-lock.json ]; then npm ci; fi` |

- `test` runs every unit and integration test once and exits non-zero on any failure. It needs `setup` to have run.
- `build` is the type check, since Node runs `.ts` directly.
- `setup` is safe to run more than once and when several worktrees run it at the same time. It skips `npm ci` until the first story has created `package-lock.json`.

The first story must add to `vitest.config.ts`: `globalSetup: ['tests/support/global-setup.ts']`, `fileParallelism: false`, `env.TEST_DATABASE_URL` as above, and `testTimeout: 30_000` (workflow tests start a worker). It also adds `.factory/` to `.gitignore`.

The same three, written to `.factory.toml` at the repo root (the factory reads them from there):

```toml
[commands]
test = "npx vitest run"
build = "npx tsc --noEmit"
setup = "if [ -f package-lock.json ]; then npm ci; fi"
```

---

## CI

| Check | Blocks a merge | Command |
|-------|----------------|---------|
| Tests | yes | `npx vitest run` |
| Type check | yes | `npx tsc --noEmit` |
| Secret scan | yes | `gitleaks git --redact --exit-code 1` (the gitleaks CLI, not gitleaks-action) |
| Lint | no (no linter at poc) | — |

One GitHub Actions job, `ci` in `.github/workflows/ci.yml`, runs on every pull request to `main`. It runs on `ubuntu-latest` (x86_64; the time-skipping server doesn't run on ARM) with Node 26 and no Postgres service: the tests start their own, as they do in a worktree. It checks out with full history (`fetch-depth: 0`) so gitleaks can scan the PR's commits. Its steps are `gitleaks git --redact --exit-code 1`, `npm ci`, `npx tsc --noEmit` and `npx vitest run`, with `FACTORY_DB_NAME=calvin_test`. No secrets are set in CI. It must finish within 5 minutes. The `standards` stage turns this into the guardrails story.
