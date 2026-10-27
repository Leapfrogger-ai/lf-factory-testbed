# Coding standards

Judgment rules for reviewers. Each is one sentence a reviewer can answer yes or no to, then its reason. Rules a tool checks are under "Mechanical rules", not here. These standards start small and grow: a rule is added when a review or a retrospective shows it's needed.

Maturity: **poc**. Terms are the ones in `GLOSSARY.md`.

## Platform

Use what the stack provides; each rule comes from a "Platform Capabilities" row in `specs/calvin/architecture.md`.

- Use Temporal's durable timers (`sleep`, `condition(fn, timeout)`) for waiting until the commit deadline, reminders and check-in; don't hand-roll a cron job, a due-items table or `setTimeout` — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Temporal's signals (`defineSignal`, `setHandler`, `WorkflowHandle.signal`) to wake a plan's workflow on confirm, late commit and call-off; don't poll Postgres for state changes — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Temporal's activity retry policy and timeouts (`proxyActivities`, `retry`, `startToCloseTimeout`, `scheduleToCloseTimeout`) for retrying Postgres and Resend calls; don't hand-roll retry loops or backoff — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Temporal's workflow ID uniqueness (`workflowId: plan-<planId>`, default conflict policy) for one workflow per plan; don't keep a "workflow started" flag in Postgres — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Temporal's `patched()` / `deprecatePatch()` for any change to `planWorkflow` once plans are live, with a replay test against a recorded history; don't hand-roll version flags — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use `@temporalio/envconfig`'s `loadClientConnectConfig()` to connect the client and worker; don't wire address, namespace, TLS and API key by hand — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use `@temporalio/testing`'s `TestWorkflowEnvironment.createTimeSkipping()` to test the plan workflow's timers; don't fake clocks or mock `sleep` — [finding](specs/calvin/research/temporal-typescript-sdk.md).
- Use Resend's idempotency keys (`emails.send(payload, { idempotencyKey })`) so a retried activity doesn't re-send; don't hand-roll send-then-check — [finding](specs/calvin/research/resend.md).
- Use Resend's tags (`{ name: "kind", value: <kind> }`) to mark each email's kind — [finding](specs/calvin/research/resend.md).
- Use Resend's test addresses (`delivered@resend.dev`, `bounced@resend.dev`) for any test against the real API; don't run a fake SMTP server — [finding](specs/calvin/research/resend.md).
- Use Resend's domain verification (SPF on the `send.` subdomain, DKIM `resend._domainkey`) for deliverability — [finding](specs/calvin/research/resend.md).
- Use the Anthropic web search tool (`web_search_20260318`, `max_uses`, `user_location`) to check suggested venues; don't add a places API or scraping — [finding](specs/calvin/research/anthropic-api.md).
- Use Anthropic strict tool use (`strict: true` on `propose_plan`) for schema-valid suggestions; don't parse or repair free-text JSON — [finding](specs/calvin/research/anthropic-api.md).
- Use `@anthropic-ai/sdk`'s `timeout`, `maxRetries` and `signal` for the 20s hard limit; don't hand-roll `Promise.race` timers — [finding](specs/calvin/research/anthropic-api.md).
- Use Node 26's JS `Temporal` (`Temporal.ZonedDateTime` in `America/Los_Angeles`) for all local-time math; don't do manual offset math or add `date-fns-tz` or `luxon` — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Node 26's native TypeScript type stripping to run `.ts`; don't add a `tsc`/esbuild build pipeline — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `crypto.randomBytes(32).toString('base64url')` (through `newToken()`) for capability tokens; don't use `randomUUID` or a custom scheme — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `hono/csrf` for CSRF protection on every POST; don't add hidden form tokens — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `hono/secure-headers` (with `NONCE` and `Referrer-Policy: no-referrer`) for security headers; don't set them by hand — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `c.req.parseBody()` and `@hono/zod-validator` with an error hook for forms; don't parse bodies by hand — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Hono's `app.onError`, `app.notFound` and `HTTPException` for the error and not-found pages; don't try/catch in every route — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Hono's `app.request()` for route tests; don't add supertest or listen on a port — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Drizzle's `onConflictDoUpdate` (target `[planId, emailNormalized]`) for a repeat commit; don't select-then-insert — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Drizzle's `db.transaction` and `.for('update')` for commit, confirm, call-off and deadline resolution; don't add application locks — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use drizzle-kit `generate` and `migrate(db, { migrationsFolder })` for schema migrations; don't write a SQL runner — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Fly's `release_command` to run migrations before each deploy; don't migrate on boot — [finding](specs/calvin/research/fly-and-neon.md).
- Use Fly secrets (`fly secrets set`) for every production secret; don't put `.env` files on the server — [finding](specs/calvin/research/fly-and-neon.md).
- Use Fly's `[[http_service.checks]]`, `fly certs add` and `fly logs` for health, HTTPS and logs; don't manage TLS or ship logs yourself — [finding](specs/calvin/research/fly-and-neon.md).
- Use a Neon branch when a throwaway database is wanted; don't seed a separate server — [finding](specs/calvin/research/fly-and-neon.md).

## Structure

- Plan and commit state changes only in `src/domain/plans.ts`, inside a transaction that locks the plan row and appends its event through `appendEvent` — one source of truth, and commit races settle on the row lock. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Workflow code imports only `@temporalio/workflow` and types, gets its schedule as epoch milliseconds, and uses neither `Intl` nor JS `Temporal` — workflow code must replay deterministically. ([ADR 0001](docs/adr/0001-temporal-workflow-per-plan.md))
- Every activity re-reads Postgres and acts only if the plan's state still matches (no reminder unless `confirmed`, no `not_this_time` unless `called_off`, nothing to withdrawn committers) — signals are hints, not state. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Every email is sent through `sendOnce`, with its payload built only from stored data — that's what makes each email go out exactly once and a retry identical. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md), [ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address — SQL and I/O stay in one module, and NFR006 holds by construction.
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed in. ([test-strategy](specs/calvin/test-strategy.md))
- Times are stored as UTC `timestamptz`, and every local-time rule and display format goes through `src/domain/time.ts` with `PLAN_TIME_ZONE` — one place for DST and the UX §8.8 formats.
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.

## Errors and configuration

- Errors follow the architecture's Error Handling section: a field error re-renders the same page with 422 and keeps what was entered, any bad token is the same 404 page (a malformed one without a database query), a suggestion failure is a fallback card and never a 5xx, and anything unexpected goes to `app.onError` with no stack trace on the page — users never see a different error shape per route.
- A Temporal signal or start failure after a committed transaction is logged at `error` and never fails the user's request — the commit already stands. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Environment variables are read only in `src/config.ts` (and `DATABASE_URL` in `src/db/migrate.ts`), validated with zod at startup — one place says what the app needs.
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities. ([ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))

## Security

- No secret is read, stored, logged or committed other than as the architecture's Secrets table says (env vars from Fly secrets or a gitignored `.env`; never in `fly.toml`, the Dockerfile, the repo, a log line or a CI command line; `.env.example` holds names only) — a leaked secret can't be taken back.

## Tests

- Tests verify behaviour through public interfaces, at the seams `specs/calvin/test-strategy.md` names — tests that reach inside break on every refactor.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- Every DST-sensitive rule has a test on 2026-11-01 and 2027-03-14 in `America/Los_Angeles` — that's where local-time rules break.

## Mechanical rules

Enforced by tools, not reviewers. The guardrails story sets them up; CI blocks a merge on each.

| Rule | Tool and setting | CI check |
|------|------------------|----------|
| Types | TypeScript, `tsconfig.json` with `"strict": true`, `"erasableSyntaxOnly": true`, `"verbatimModuleSyntax": true`, `"allowImportingTsExtensions": true`, `"noEmit": true` | `npx tsc --noEmit` |
| Tests pass | Vitest 5, `vitest.config.ts` as test-strategy.md's Commands section says | `npx vitest run` |
| No secret committed | gitleaks CLI (the binary, not gitleaks-action, which needs a license key for organizations), default rules, `--redact` | `gitleaks git --redact --exit-code 1` over the PR's commits |
| Formatting | None at poc | — |
| Lint | None at poc (test-strategy.md) | — |

The judgment rules a linter could check later (no `vi.mock` of project files, no `Date.now()` outside `main.ts`, workflow-safe imports, no `luxon`/`date-fns-tz`) stay reviewer checks until a linter is added.

The CI job: `ci` in `.github/workflows/ci.yml`, on every pull request to `main`; `ubuntu-latest`, Node 26, a `postgres:17` service on `54329:5432` with `POSTGRES_PASSWORD=calvin`, `FACTORY_DB_NAME=calvin_test`; steps: checkout with full history (`fetch-depth: 0`) for gitleaks, `gitleaks git --redact --exit-code 1`, `npm ci`, `npx tsc --noEmit`, `npx vitest run`. No secrets are set in CI.
