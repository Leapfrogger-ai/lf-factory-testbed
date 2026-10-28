# Story 1.1: Project skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the calvin stack (Node 26 + TypeScript without a build step, Hono, Drizzle, Vitest 5 with an embedded Postgres 17) with `/healthz`, the not-found page, Migration 0000 and a CI job, so every later story lands on a working build.

**Architecture:** `createApp(deps)` in `src/web/app.ts` builds a Hono app. Vitest's `globalSetup` starts `embedded-postgres` on TCP, creates the worktree's database and applies the drizzle-kit-generated migrations through `src/db/migrate.ts`. CI is one GitHub Actions job that runs the same two commands.

**Tech Stack:** Node 26, TypeScript (type stripping, `tsc --noEmit` only), Hono + `@hono/node-server`, zod, Drizzle 0.45.4 + `pg`, drizzle-kit 0.31.11, Vitest 5, `embedded-postgres` 17.10.0-beta.17, `@temporalio/*` 1.24.0.

**Spec:** .factory/story.md (story #80)

## Global Constraints

- Use Node 26's native TypeScript type stripping to run `.ts`; don't add a `tsc`/esbuild build pipeline — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use drizzle-kit `generate` and `migrate(db, { migrationsFolder })` for schema migrations; don't write a SQL runner — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Hono's `app.onError`, `app.notFound` and `HTTPException` for the error and not-found pages; don't try/catch in every route — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Hono's `app.request()` for route tests; don't add supertest or listen on a port — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine — [finding](specs/calvin/research/node-hono-drizzle.md).
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed in. ([test-strategy](specs/calvin/test-strategy.md))
- Environment variables are read only in `src/config.ts` (and `DATABASE_URL` in `src/db/migrate.ts`), validated with zod at startup — one place says what the app needs.
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- Tests verify behaviour through public interfaces, at the seams `specs/calvin/test-strategy.md` names — tests that reach inside break on every refactor.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- No secret is read, stored, logged or committed other than as the architecture's Secrets table says (env vars from Fly secrets or a gitignored `.env`; never in `fly.toml`, the Dockerfile, the repo, a log line or a CI command line; `.env.example` holds names only) — a leaked secret can't be taken back.
- `tsconfig.json` sets `"erasableSyntaxOnly": true`, `"verbatimModuleSyntax": true`, `"noEmit": true` and `"allowImportingTsExtensions": true`. No enums and no namespaces; use `import type` for types. Imports use the `.ts` extension.
- `hono@^4` is pinned below 5.0 (5.0.0-rc.1 changes `onError`). Drizzle is pinned to 0.45.x, not the 1.0 RC, whose migrations folder layout differs.
- All `@temporalio/*` packages are pinned to exactly the same version.
- `TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database.
- the test run's own, started by `embedded-postgres` on `127.0.0.1:${FACTORY_PORT_BASE + 2}` (default 20002), user `postgres`, password `calvin`, data in the worktree's `.factory/pgdata`.
- Vitest's `globalSetup` (`tests/support/global-setup.ts`) starts Postgres with `embedded-postgres` (`persistent: false`, data in `.factory/pgdata`, and `postgresFlags: ['-c', 'unix_socket_directories=']` so it listens on TCP only: the sandbox's `/tmp` is read-only, and a socket path in the worktree would be too long).
- `fileParallelism: false` makes test files run one after another.
- The first story must add to `vitest.config.ts`: `globalSetup: ['tests/support/global-setup.ts']`, `fileParallelism: false`, `env.TEST_DATABASE_URL` as above, and `testTimeout: 30_000`. It also adds `.factory/` to `.gitignore`.
- `src/db/migrate.ts` reads only `DATABASE_URL`, not the whole `config.ts`, so it runs in tests and setup without the app's secrets.
- `src/db/client.ts` passes `casing: 'snake_case'` to `drizzle()`, and `drizzle.config.ts` sets the same, so camelCase fields map to the snake_case columns.
- The CI job: `ci` in `.github/workflows/ci.yml`, on every pull request to `main`; `ubuntu-latest`, Node 26, no Postgres service (the tests start their own with `embedded-postgres`, test-strategy.md), `FACTORY_DB_NAME=calvin_test`; steps: checkout with full history (`fetch-depth: 0`) for gitleaks, `gitleaks git --redact --exit-code 1`, `npm ci`, `npx tsc --noEmit`, `npx vitest run`. No secrets are set in CI.
- drizzle-kit generates the migration from this; the generated SQL must match the migration below in substance (column types, nullability, defaults, constraints and indexes; names may differ in order).

Binding: CODING_STANDARDS.md, specs/calvin/test-strategy.md, specs/calvin/architecture.md, specs/calvin/database-schema.md

## Review Focus

- `POST /nope` (any non-GET method on an unknown path) → the same 404 page, not a 405 or a crash. Pinned in Task 4.
- `HEAD /healthz` and `/healthz?x=1` → still 200 with no database access. Pinned in Task 4.
- A second `npx vitest run` right after a finished one (or after a killed one that left `.factory/pgdata`) → starts clean, no "database already exists" or "address in use" failure. Pinned in Task 3.
- A different `FACTORY_PORT_BASE` / `FACTORY_DB_NAME` → the config and the global setup use them, not the defaults. Pinned in Task 3.
- Unknown path with a trailing slash or malformed percent-encoding (`/nope/`, `/%E0%A4%A`) → 404 page, no 500. Pinned in Task 4.

## Scope note

Per the story, `src/config.ts`, `src/main.ts`, `tests/support/{fakes,builders,db}.ts`, `src/log.ts` and the API specification's §2 headers come with Story 1.3 / 1.6. Tests here build their own deps inline.

## File Structure

- `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore` — stack and type-check config (`.factory.toml` already exists, unchanged).
- `src/db/schema.ts` — the Drizzle schema, copied from database-schema.md "Drizzle Schema".
- `src/domain/events.ts` — type-only `EventData` the schema imports.
- `src/db/migrate.ts` — applies migrations; `drizzle.config.ts`, `drizzle/0000_*.sql` (+ `drizzle/meta/`) — generated.
- `tests/support/global-setup.ts`, `vitest.config.ts` — test runner.
- `src/web/app.ts`, `src/web/views/layout.ts`, `src/web/views/not-found-page.ts` — app.
- `.github/workflows/ci.yml` — CI.
- Tests: `tests/project.test.ts`, `src/db/schema.test.ts`, `tests/support/global-setup.test.ts`, `src/web/app.test.ts`, `tests/ci-workflow.test.ts`.

### Task 1: Package, TypeScript and ignore rules

**Covers:** AC2

**Files:**
- Create: `package.json`, `package-lock.json`, `tsconfig.json`, `src/domain/events.ts`
- Modify: `.gitignore` (create if absent)
- Test: `tests/project.test.ts`

**Interfaces:**
- Produces: `export type EventData = { data: Record<string, unknown> }` in `src/domain/events.ts` (placeholder; the schema only needs `EventData['data']`).

- [ ] **Step 1: Install the toolchain only** (so a test can run): `npm init -y`, `npm pkg set type=module engines.node=">=26"`, then the architecture's two `npm install` lines (runtime and `-D`), using `--save-exact` for every `@temporalio/*`, `drizzle-orm` and `embedded-postgres`.
- [ ] **Step 2: Write the failing test** `tests/project.test.ts`, reading `package.json`, `.gitignore`, `tsconfig.json` as files, asserting: `type === "module"`, `engines.node === ">=26"`; every dependency (either list) whose key starts `@temporalio/` has version exactly `1.24.0`; `devDependencies["embedded-postgres"] === "17.10.0-beta.17"`; `dependencies["drizzle-orm"] === "0.45.4"`; `.gitignore` has lines `.factory/` and `node_modules/`; tsconfig `compilerOptions` has `strict`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `noEmit` all `true`.
- [ ] **Step 3: Run** `npx vitest run tests/project.test.ts` → FAIL (no `tsconfig.json`/`.gitignore` yet).
- [ ] **Step 4: Write** `tsconfig.json` (the five flags plus `"strict": true`, `"module": "nodenext"`, `"target": "esnext"`, `"include": ["src", "tests", "*.ts"]`), `.gitignore` (`.factory/`, `node_modules/`, `.env`), and `src/domain/events.ts`. If `@types/node` lacks JS `Temporal` types, add a `src/temporal-types.d.ts` declaring only what `deps.now` needs (Task 4).
- [ ] **Step 5: Run** `npx vitest run tests/project.test.ts` → PASS, and `npx tsc --noEmit` → exit 0.
- [ ] **Step 6: Commit** `git add package.json package-lock.json tsconfig.json .gitignore src tests && git commit -m "Project skeleton: stack, tsconfig, ignores"`

### Task 2: Drizzle schema and Migration 0000

**Covers:** AC3

**Files:**
- Create: `src/db/schema.ts`, `drizzle.config.ts`, `drizzle/0000_*.sql`, `drizzle/meta/*`, `src/db/migrate.ts`
- Test: `src/db/schema.test.ts`

**Interfaces:**
- Produces: `schema.ts` exports `suggestions, plans, commits, emailSends, checkInAnswers, events`. `migrate.ts` exports `migrate(databaseUrl: string, migrationsFolder = 'drizzle'): Promise<void>` (opens a `pg.Pool`, runs drizzle's `migrate`, ends the pool); run directly (`import.meta.main`) it calls `migrate(process.env.DATABASE_URL)` and exits non-zero with a message naming `DATABASE_URL` if unset.

- [ ] **Step 1: Write the failing test** `src/db/schema.test.ts` (unit, no Postgres): `getTableConfig` (from `drizzle-orm/pg-core`) over the six exports gives names exactly `suggestions, plans, commits, email_sends, check_in_answers, events`; `plans` has a check named `plans_state_timestamps_check`; `commits` has a unique constraint `commits_plan_id_email_normalized_key`.
- [ ] **Step 2: Run** `npx vitest run src/db/schema.test.ts` → FAIL, module not found.
- [ ] **Step 3: Implement** `src/db/schema.ts` by copying the code block under "Drizzle Schema" in database-schema.md verbatim. Write `drizzle.config.ts` (`dialect: 'postgresql'`, `schema: './src/db/schema.ts'`, `out: './drizzle'`, `casing: 'snake_case'`). Run `npx drizzle-kit generate`; don't hand-edit the SQL. Write `migrate.ts` with `migrate` from `drizzle-orm/node-postgres/migrator`.
- [ ] **Step 4: Run** the test → PASS. Compare the generated `drizzle/0000_*.sql` with "Migration 0000" in database-schema.md for substance; record a substantive difference as a `Ruling:` in this plan's Rulings section.
- [ ] **Step 5: Commit** `git add src/db drizzle drizzle.config.ts && git commit -m "Drizzle schema and Migration 0000"`

### Task 3: Vitest config and global Postgres setup

**Covers:** AC1, AC3

**Files:**
- Create: `vitest.config.ts`, `tests/support/global-setup.ts`
- Test: `tests/support/global-setup.test.ts`

**Interfaces:**
- Consumes: `migrate(databaseUrl: string, migrationsFolder?: string): Promise<void>` (Task 2).
- Produces: `vitest.config.ts` with `test.globalSetup: ['tests/support/global-setup.ts']`, `fileParallelism: false`, `testTimeout: 30_000`, `env.TEST_DATABASE_URL`. `global-setup.ts` default-exports `async function setup(): Promise<() => Promise<void>>` (the returned function stops Postgres). Port is `Number(process.env.FACTORY_PORT_BASE ?? 20000) + 2`; database is `process.env.FACTORY_DB_NAME ?? 'calvin_test'`.

- [ ] **Step 1: Write the failing test** `tests/support/global-setup.test.ts`: connect a `pg.Client` to `process.env.TEST_DATABASE_URL`; assert the `public` tables in `information_schema.tables` include `suggestions`, `plans`, `commits`, `email_sends`, `check_in_answers`, `events`; assert `select version()` matches `/PostgreSQL 17/`; assert `TEST_DATABASE_URL` equals the string `postgres://postgres:calvin@127.0.0.1:<FACTORY_PORT_BASE or 20000, plus 2>/<FACTORY_DB_NAME or calvin_test>`, written out in the test from the spec's rule, not imported from the config.
- [ ] **Step 2: Run** `npx vitest run tests/support/global-setup.test.ts` → FAIL (no `TEST_DATABASE_URL`, no server).
- [ ] **Step 3: Implement** `vitest.config.ts` and `global-setup.ts`: `new EmbeddedPostgres({ databaseDir: '.factory/pgdata', port, user: 'postgres', password: 'calvin', persistent: false, postgresFlags: ['-c', 'unix_socket_directories='] })`, `initialise()`, `start()`, create the database only if it's missing (query `pg_database` first), `await migrate(url)`, return a teardown calling `stop()`. Remove a stale `.factory/pgdata` before `initialise()` so every run starts empty.
- [ ] **Step 4: Run** `npx vitest run` → PASS; run it a second time immediately → PASS (no stale-data or port error); run `FACTORY_PORT_BASE=21000 FACTORY_DB_NAME=other_db npx vitest run` → PASS against port 21002 and `other_db`.
- [ ] **Step 5: Commit** `git add vitest.config.ts tests && git commit -m "Vitest config with embedded Postgres global setup"`

### Task 4: `createApp(deps)`, `/healthz` and the not-found page

**Covers:** AC5, AC6

**Files:**
- Create: `src/web/app.ts`, `src/web/views/layout.ts`, `src/web/views/not-found-page.ts`
- Test: `src/web/app.test.ts`

**Interfaces:**
- Produces, in `src/web/app.ts`:
  - `export type AppDeps = { db: Db; now: () => Temporal.Instant; suggestPlanCall: (request: unknown) => Promise<unknown>; sendEmail: (payload: unknown, idempotencyKey: string) => Promise<{ id: string }>; planWorkflows: { start(planId: string, schedule: unknown): Promise<void>; signal(planId: string, signal: string, arg?: unknown): Promise<void> } }`, where `Db = NodePgDatabase<typeof schema>` (placeholders that later stories narrow).
  - `export function createApp(deps: AppDeps): Hono`.
- `notFoundPage(): HtmlEscapedString` in `views/not-found-page.ts`; `layout(title: string, body: HtmlEscapedString): HtmlEscapedString` in `views/layout.ts` (a minimal `<html>` shell; no stylesheet, that is Story 1.3).

- [ ] **Step 1: Write the failing tests** in `src/web/app.test.ts`, one at a time, with a local `deps` builder: `db` is a `Proxy` that throws on any property access (proves no query), the other three functions throw if called, `now` returns a fixed instant.
  1. `GET /healthz` → 200, `content-type` starts with `text/plain`, body `ok`.
  2. `GET /nope` → 404, `content-type` starts with `text/html`, and the body (HTML entities decoded) contains "We can't find that plan. The link may be incomplete. Check it in your chat or email." and `<a href="/">Suggest a plan</a>`.
  3. Review Focus: `POST /nope` → 404 same page; `HEAD /healthz` → 200; `GET /healthz?x=1` → 200 `ok`; `GET /nope/` and `GET /%E0%A4%A` → 404, not 500.
- [ ] **Step 2: Run** `npx vitest run src/web/app.test.ts` → FAIL, module not found.
- [ ] **Step 3: Implement** `createApp` with `app.get('/healthz', (c) => c.text('ok'))` and `app.notFound` returning the layout-wrapped page with status 404, HTML via `hono/html`. `deps` is accepted and otherwise unused.
- [ ] **Step 4: Run** `npx vitest run src/web/app.test.ts` → PASS, and `npx tsc --noEmit` → exit 0.
- [ ] **Step 5: Commit** `git add src/web && git commit -m "createApp with /healthz and not-found page"`

### Task 5: CI workflow

**Covers:** AC4, AC1

**Files:**
- Create: `.github/workflows/ci.yml`
- Test: `tests/ci-workflow.test.ts`

- [ ] **Step 1: Write the failing test** `tests/ci-workflow.test.ts`: read `.github/workflows/ci.yml` as text and assert it contains `pull_request`, `main`, a job key `ci:`, `runs-on: ubuntu-latest`, `node-version: 26`, `fetch-depth: 0`, `FACTORY_DB_NAME: calvin_test`, and the run lines `npm ci`, `npx tsc --noEmit`, `npx vitest run` in that order; and does not contain `services:` or `secrets.`. (A text check; no YAML dependency at poc. The gitleaks step is Story 1.2's.)
- [ ] **Step 2: Run** `npx vitest run tests/ci-workflow.test.ts` → FAIL (file missing).
- [ ] **Step 3: Write** `ci.yml`: `on: pull_request: branches: [main]`; job `ci` on `ubuntu-latest` with `env: FACTORY_DB_NAME: calvin_test`; steps `actions/checkout` (`fetch-depth: 0`), `actions/setup-node` (`node-version: 26`, `cache: npm`), `npm ci`, `npx tsc --noEmit`, `npx vitest run`.
- [ ] **Step 4: Run the whole check** `if [ -f package-lock.json ]; then npm ci; fi && npx tsc --noEmit && npx vitest run` → exit 0, all tests pass.
- [ ] **Step 5: Commit** `git add .github tests && git commit -m "CI job for pull requests to main"`

## Rulings

Ruling: AC4's "reports the result on the pull request" is proven by a text check of `ci.yml`, because a workflow can't run locally — if wrong, a misconfiguration shows on the story's first PR and is a one-line fix.
Ruling: `src/domain/events.ts` is a type-only placeholder because `schema.ts` imports it and no earlier story writes it — if wrong, `events.data` is typed loosely until a later story narrows `EventData`.
Ruling: the `gitleaks` step is left out of `ci.yml` because Story 1.2 owns it — if wrong, secret scanning arrives one story later.
Ruling: `AppDeps` member types are `unknown`-shaped placeholders because the real boundary types arrive with Stories 1.3 and later — if wrong, those stories tighten them with no behaviour change.
