# Architecture: calvin

**Date**: 2026-10-27
**Version**: 1.0
**Maturity**: poc
**Inputs**: [brief.md](./brief.md), [PRD.md](./PRD.md), [ux-spec.md](./ux-spec.md), [GLOSSARY.md](../../GLOSSARY.md)

---

## Executive Summary

calvin is one TypeScript process on one always-on Fly.io machine. It serves server-rendered HTML pages with Hono and runs a Temporal worker, connected to the operator's Temporal Cloud namespace. Postgres (Neon) owns every plan's state, commits and event log. Each plan has one Temporal workflow that only keeps time: commit deadline, reminders and check-in. Claude Sonnet 5.5 with web search suggests plans, and Resend sends every email exactly once, backed by a send ledger in Postgres. There are no accounts, no JSON API and no client framework. Pages are plain HTML forms that work without JavaScript.

**Naming**: in this document **Temporal** means temporal.io, the workflow platform. The JavaScript date and time API is called **JS `Temporal`**.

---

## Project Context

**Scale**: 4 epics and about 18 stories; 3–5 trial plans with tens of people.
**Key characteristics**:
- **Time-driven lifecycle**: commit deadline, two reminders and a check-in per plan, each within 5 minutes of its due time (NFR007), all in America/Los_Angeles.
- **Each email exactly once** across retries and restarts (NFR008).
- **Phone-first pages** opened in chat apps' in-app browsers: ≤2s first render over 4G (NFR002), working without JS (UX §10.2).
- **Capability links instead of accounts**: public, manage, withdraw and check-in tokens with ≥128 bits of randomness (NFR005).
- **Cost** under ~$20/month (NFR010). The estimate is about $5/month plus usage.

---

## Project Initialization

There's no starter template. The stack is small enough that a generator would add more than it saves. The first story creates the repository by hand:

```bash
npm init -y
npm pkg set type=module engines.node=">=26"
npm install hono@^4.13.14 @hono/node-server@^2.1.5 @hono/zod-validator@^0.9.1 zod@^4.6.7 \
  drizzle-orm@0.45.4 pg@^8.23.1 @anthropic-ai/sdk@^1.3.0 resend@^6.34.1 \
  @temporalio/client@1.24.0 @temporalio/worker@1.24.0 @temporalio/workflow@1.24.0 \
  @temporalio/activity@1.24.0 @temporalio/envconfig@1.24.0
npm install -D typescript @types/node @types/pg drizzle-kit@0.31.11 vitest@^5.0.5 @temporalio/testing@1.24.0 \
  embedded-postgres@17.10.0-beta.17
```

**This establishes**:
- Node 26 runs `.ts` files directly through native type stripping, so there's no build step. `tsc --noEmit` only checks types.
- `tsconfig.json` sets `"erasableSyntaxOnly": true`, `"verbatimModuleSyntax": true`, `"noEmit": true` and `"allowImportingTsExtensions": true`. No enums and no namespaces; use `import type` for types. Imports use the `.ts` extension.
- `hono@^4` is pinned below 5.0 (5.0.0-rc.1 changes `onError`). Drizzle is pinned to 0.45.x, not the 1.0 RC, whose migrations folder layout differs.
- All `@temporalio/*` packages are pinned to exactly the same version.

---

## Decision Summary

| Category | Decision | Version | Rationale | Affects Epics |
|----------|----------|---------|-----------|---------------|
| Runtime | Node.js, native TS type stripping | 26.x (Active LTS from 2026-10-28) | JS `Temporal` is built in for time zone math; no build step | All |
| Web framework | Hono + `@hono/node-server`, HTML via `hono/html` | hono 4.13.x, node-server 2.1.x | Tiny, built-in CSRF, secure headers and form parsing; `hono/html` works in plain `.ts` (no `.tsx` under type stripping) | All |
| Validation | Zod via `@hono/zod-validator` | zod 4.6.x, validator 0.9.x | Validates at the form boundary and re-renders with errors | 1, 2, 3 |
| Database | Neon Postgres, Free plan, `aws-us-west-2` | Postgres (Neon default) | Relational, unique constraints and row locks for commit races; free; closest region to sjc | All |
| DB access | Drizzle ORM + `pg` (TCP, small `pg.Pool`, direct connection string) | drizzle-orm 0.45.4, drizzle-kit 0.31.11, pg 8.23.1 | Typed SQL, `onConflictDoUpdate`, generated migrations | All |
| Workflow engine | Temporal Cloud (operator's account), TypeScript SDK | `@temporalio/*` 1.24.0 | Durable timers, retries and replay for the plan's time ([ADR 0001](../../docs/adr/0001-temporal-workflow-per-plan.md)) | 3, 4 |
| State ownership | Postgres owns state; the workflow only keeps time | — | One source of truth, pages never wait on Temporal ([ADR 0002](../../docs/adr/0002-postgres-owns-state-temporal-owns-time.md)) | 2, 3, 4 |
| LLM | Claude Sonnet 5.5 + web search tool + strict `propose_plan` tool | `claude-sonnet-5-5`, `web_search_20260318`, `@anthropic-ai/sdk` 1.3.x | Venues checked as real ([ADR 0004](../../docs/adr/0004-suggestions-sonnet-web-search.md)) | 1 |
| Email | Resend, plain text-first emails, idempotency keys | `resend` 6.34.x | PRD constraint; idempotency keys | 1, 3, 4 |
| Hosting | One Fly.io Machine, `shared-cpu-1x` 512MB, `sjc`, autostop off, web + worker in one process | flyctl current | The worker must stay up; about $4.40/month ([ADR 0003](../../docs/adr/0003-single-fly-machine.md)) | All |
| Testing | Vitest; `@temporalio/testing` time-skipping env; `app.request()` for routes | vitest 5.0.x | Fast, ESM-native, runs `.ts` directly | All |
| Styling | One hand-written CSS file with tokens (UX §3–4) | — | The UX spec decided it; < 10 KB | All |

---

## Project Structure

```
calvin/
├── src/
│   ├── main.ts                     # Entry: runs migrations check, starts HTTP server + Temporal worker
│   ├── config.ts                   # Reads and validates env vars (zod); CITIES list; BASE_URL
│   ├── web/
│   │   ├── app.ts                  # Hono app: middleware (csrf, secure-headers, logger), routes, onError/notFound
│   │   ├── routes/
│   │   │   ├── create.ts           # GET /, POST /suggest, POST /plans, GET /m/:token/new
│   │   │   ├── plan.ts             # GET /p/:token, POST /p/:token/commit
│   │   │   ├── manage.ts           # GET /m/:token, GET /m/:token/published, POST /m/:token/call-off
│   │   │   ├── withdraw.ts         # GET /w/:token, POST /w/:token
│   │   │   └── check-in.ts         # GET /c/:token/:question/:answer
│   │   ├── views/                  # hono/html templates, one file per screen + partials
│   │   │   ├── layout.ts           # <html>, head, OG tags, stylesheet link
│   │   │   ├── create-page.ts
│   │   │   ├── suggestion-card.ts
│   │   │   ├── published-page.ts
│   │   │   ├── plan-page.ts
│   │   │   ├── seat-row.ts
│   │   │   ├── state-pill.ts
│   │   │   ├── manage-page.ts
│   │   │   ├── withdraw-page.ts
│   │   │   ├── check-in-page.ts
│   │   │   └── not-found-page.ts
│   │   └── forms.ts                # zod schemas for every form
│   ├── domain/
│   │   ├── plan-rules.ts           # Pure: default deadline, minimum rules, schedule (reminder/check-in instants), state helpers
│   │   ├── plans.ts                # Postgres operations: publish, commit, withdraw, callOff, resolveDeadline (transactions)
│   │   ├── tokens.ts               # newToken(): randomBytes(32).toString('base64url')
│   │   └── time.ts                 # JS Temporal helpers: LA zone ↔ UTC instants, display formats (UX §8.8)
│   ├── suggest/
│   │   └── suggest.ts              # Anthropic call, propose_plan tool, timeout + fallback
│   ├── email/
│   │   ├── templates.ts            # One function per email kind → { subject, text } (UX §8.9)
│   │   └── send.ts                 # Ledger + Resend send with idempotency key
│   ├── temporal/
│   │   ├── client.ts               # Temporal Client (envconfig), startPlanWorkflow, signal helpers
│   │   ├── worker.ts               # Worker.create(...) on task queue "calvin"
│   │   ├── workflows.ts            # planWorkflow (bundled by the worker; workflow-safe imports only)
│   │   └── activities.ts           # resolveDeadline, sendToCommitters, sendToOne, sendCheckIn
│   ├── db/
│   │   ├── schema.ts               # Drizzle schema
│   │   ├── client.ts               # pg.Pool + drizzle()
│   │   └── migrate.ts              # Runs drizzle migrations (Fly release_command)
│   └── log.ts                      # JSON-lines logger to stdout, redacts tokens
├── drizzle/                        # Generated SQL migrations (drizzle-kit generate)
├── public/
│   ├── app.css                     # Tokens + base styles (UX §4)
│   ├── create.js                   # Progressive enhancement on create only (spinner text, copy, share)
│   └── og.png                      # Static OG card
├── tests/                          # Cross-module tests (workflow, end-to-end lifecycle)
├── drizzle.config.ts
├── fly.toml
├── Dockerfile                      # node:26-slim, npm ci --omit=dev, CMD node src/main.ts
├── .env.example                    # Every variable, no values
├── tsconfig.json
└── vitest.config.ts
```

Unit tests sit next to their source as `*.test.ts`. `tests/` holds the workflow and lifecycle tests that cut across modules.

---

## Epic to Architecture Mapping

| Epic | Primary Components | Key Technologies | Integration Points |
|------|-------------------|------------------|-------------------|
| 1: Create and publish a plan | `web/routes/create.ts`, `suggest/`, `domain/plans.ts` (publish), `domain/plan-rules.ts`, `email/` (manage-link), `temporal/client.ts` (start) | Hono, Zod, Anthropic SDK, Drizzle, Resend | Anthropic API, Resend, Temporal Cloud (workflow start) |
| 2: Commit on the public page | `web/routes/plan.ts`, `web/routes/withdraw.ts`, `domain/plans.ts` (commit, withdraw), `views/seat-row.ts` | Hono, Drizzle (row lock, upsert) | Temporal Cloud (signals) |
| 3: Confirm, remind and call off | `temporal/workflows.ts`, `temporal/activities.ts`, `email/`, `web/routes/manage.ts` | Temporal timers and signals, Resend, Drizzle | Temporal Cloud, Resend |
| 4: Check-in and trial data | `web/routes/check-in.ts`, check-in activity, `events` table | Drizzle | Resend |

---

## Technology Stack Details

### Core Technologies

#### Node.js 26
- **Purpose**: runtime for both the web server and the Temporal worker.
- **Configuration**: run `.ts` directly (`node src/main.ts`), with no transpiler. JS `Temporal` and full ICU are built in, so `America/Los_Angeles` needs no extra package.
- **Risk**: `@temporalio/worker` 1.24.0 declares `node >= 20.3.0` but doesn't list Node 26 explicitly. The first story that starts the worker (Story 1.3) checks it on Node 26. Node 26 is the only Node on the factory's worker, so there's no fallback to Node 24: if the worker can't run on Node 26, that story halts for the operator.
- **Resources**: [research/node-hono-drizzle.md](research/node-hono-drizzle.md)

#### Hono 4
- **Purpose**: HTTP routing, middleware and HTML rendering through the `html` tagged template (auto-escaping).
- **Configuration**: `hono/csrf` with `origin` set to `BASE_URL`, because Fly's proxy terminates TLS. `hono/secure-headers` with a CSP nonce for the create page's script. `c.redirect(url, 303)` after every POST. `app.onError` and `app.notFound` render the shared pages.

#### Temporal Cloud + TypeScript SDK 1.24.0
- **Purpose**: one `planWorkflow` per plan that keeps the plan's time, plus activities that touch Postgres and Resend.
- **Configuration**: connect with `loadClientConnectConfig()` from `@temporalio/envconfig`, using `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE` and `TEMPORAL_API_KEY`. Task queue `calvin`. Local dev uses `temporal server start-dev`.
- **Resources**: [research/temporal-typescript-sdk.md](research/temporal-typescript-sdk.md)

#### Neon Postgres + Drizzle 0.45.4 + pg 8.23.1
- **Purpose**: the source of truth for plans, commits, emails sent, check-in answers and the event log.
- **Configuration**: direct (non-pooler) connection string, `pg.Pool({ max: 5, connectionTimeoutMillis: 5000 })`. The Free plan scales to zero after 5 idle minutes, and waking takes a few hundred ms. That's acceptable, because nothing polls the database on a timer (don't add a keep-alive; it would use up the Free plan's compute hours).
- **Resources**: [research/fly-and-neon.md](research/fly-and-neon.md), [research/node-hono-drizzle.md](research/node-hono-drizzle.md)

#### Anthropic API, Sonnet 5.5
- **Purpose**: one plan suggestion per request ([ADR 0004](../../docs/adr/0004-suggestions-sonnet-web-search.md)).
- **Configuration**: `new Anthropic({ timeout: 20_000, maxRetries: 0 })` plus `signal: AbortSignal.timeout(20_000)` per request. Tools: `web_search_20260318` with `max_uses: 2` and `user_location: { type: "approximate", city, region: "California", country: "US", timezone: "America/Los_Angeles" }`, plus the strict client tool `propose_plan` (`strict: true`, `tool_choice: auto`). `effort: "low"`. Don't set `temperature`, `thinking: disabled` or a forced `tool_choice`: Sonnet 5.5 returns 400 for them.
- **Resources**: [research/anthropic-api.md](research/anthropic-api.md)

#### Resend
- **Purpose**: every email.
- **Configuration**: sending-only API key restricted to calvin's sending domain. Emails are sent with `text` only (UX §8.9: plain, text-first), a `tags: [{ name: "kind", value: <kind> }]` entry and `idempotencyKey`. The SDK returns `{ data, error }` instead of throwing, so `email/send.ts` turns errors into thrown errors: retryable for `rate_limit_exceeded`, 409 `concurrent_idempotent_requests` and 5xx; `ApplicationFailure.nonRetryable` for validation, auth and quota errors.
- **Resources**: [research/resend.md](research/resend.md)

#### Fly.io
- **Purpose**: hosting one Machine with HTTPS, secrets and logs.
- **Configuration** (`fly.toml`): `primary_region = "sjc"`; `[http_service]` `internal_port = 8080`, `force_https = true`, `auto_stop_machines = "off"`, `auto_start_machines = false`, `min_machines_running = 1`; an `[[http_service.checks]]` GET `/healthz`; `[deploy] release_command = "node src/db/migrate.ts"`; VM `shared-cpu-1x`, 512MB. No `[processes]` groups.
- **Resources**: [research/fly-and-neon.md](research/fly-and-neon.md)

### Integration Points

| Integration | Technology | Purpose | Authentication |
|------------|------------|---------|----------------|
| Anthropic API | `@anthropic-ai/sdk` | Plan suggestion | `ANTHROPIC_API_KEY` (env, read by the SDK) |
| Resend | `resend` | All email | `RESEND_API_KEY` (env, sending access, domain-restricted) |
| Temporal Cloud | `@temporalio/client`, `@temporalio/worker` | Plan workflows | `TEMPORAL_API_KEY` (env, via envconfig) |
| Neon Postgres | `pg` + Drizzle | Data | `DATABASE_URL` (env; credentials in the URL) |

---

## Platform Capabilities

The native features the build must use, so no story hand-rolls them. Every row links a research finding that cites the platform's own documentation.

| Technology | Native feature | Use it for | Instead of hand-rolling | Finding |
|------------|----------------|------------|-------------------------|---------|
| Temporal TS SDK 1.24.0 | Durable timers: `sleep`, `condition(fn, timeout)` | Waiting until the commit deadline, reminder times and check-in time | A cron job, a due-items table, `setTimeout` | [temporal-typescript-sdk.md](research/temporal-typescript-sdk.md) |
| Temporal TS SDK 1.24.0 | Signals (`defineSignal`, `setHandler`, `WorkflowHandle.signal`) | Waking the plan's workflow on confirm, late commit and call-off | Polling Postgres for state changes | [temporal-typescript-sdk.md](research/temporal-typescript-sdk.md) |
| Temporal TS SDK 1.24.0 | Activity retry policy and timeouts (`proxyActivities`, `retry`, `startToCloseTimeout`, `scheduleToCloseTimeout`) | Retrying Postgres and Resend calls | Retry loops and backoff code | [temporal-typescript-sdk.md](research/temporal-typescript-sdk.md) |
| Temporal TS SDK 1.24.0 | Workflow ID uniqueness (`workflowId`, default conflict policy `FAIL`) | One workflow per plan (`plan-<planId>`) | A "workflow started" flag in Postgres | [temporal-typescript-sdk.md](research/temporal-typescript-sdk.md) |
| Temporal TS SDK 1.24.0 | `patched()` / `deprecatePatch()` | Changing workflow code while plans are in flight | Ad-hoc version flags | [temporal-typescript-sdk.md](research/temporal-typescript-sdk.md) |
| Temporal TS SDK 1.24.0 | `@temporalio/envconfig` `loadClientConnectConfig()` | Connecting the client and worker to Temporal Cloud | Reading and wiring address, namespace, TLS and API key by hand | [temporal-typescript-sdk.md](research/temporal-typescript-sdk.md) |
| Temporal TS SDK 1.24.0 | `@temporalio/testing` `TestWorkflowEnvironment.createTimeSkipping()` | Testing the plan workflow's timers in seconds | Fake clocks, mocking `sleep` | [temporal-typescript-sdk.md](research/temporal-typescript-sdk.md) |
| Resend `resend` 6.34.x | Idempotency keys (`emails.send(payload, { idempotencyKey })`, 24h window) | Not re-sending an email on activity retry | Send-then-check races | [resend.md](research/resend.md) |
| Resend `resend` 6.34.x | Tags | Marking each email's kind in Resend's logs | — | [resend.md](research/resend.md) |
| Resend `resend` 6.34.x | Test addresses (`delivered@resend.dev`, `bounced@resend.dev`) | Integration tests against the real API | A fake SMTP server | [resend.md](research/resend.md) |
| Resend | Domain verification (SPF on `send.` subdomain, DKIM `resend._domainkey`) | NFR009 deliverability | — | [resend.md](research/resend.md) |
| Anthropic API | Web search tool `web_search_20260318` (`max_uses`, `user_location`) | Checking that suggested venues exist and are open | A places API, scraping | [anthropic-api.md](research/anthropic-api.md) |
| Anthropic API | Strict tool use (`strict: true` on `propose_plan`) | Schema-valid suggestions | Parsing and repairing free-text JSON | [anthropic-api.md](research/anthropic-api.md) |
| `@anthropic-ai/sdk` 1.3.x | `timeout`, `maxRetries`, `signal` | The 20s hard limit | `Promise.race` timers | [anthropic-api.md](research/anthropic-api.md) |
| Node 26 | JS `Temporal` (`Temporal.ZonedDateTime` with `America/Los_Angeles`) | All local-time math: default deadline, 08:00 morning, 10:00 next day, display | Manual offset math, `date-fns-tz`, `luxon` | [node-hono-drizzle.md](research/node-hono-drizzle.md) |
| Node 26 | Native TypeScript type stripping | Running `.ts` with no build step | `tsc`/esbuild build pipeline | [node-hono-drizzle.md](research/node-hono-drizzle.md) |
| Node 26 | `crypto.randomBytes(32).toString('base64url')` | 256-bit capability tokens (NFR005) | Custom token schemes; `randomUUID` (122 bits, RFC 9562 says not for capabilities) | [node-hono-drizzle.md](research/node-hono-drizzle.md) |
| Hono 4.13 | `hono/csrf` (Origin and Sec-Fetch-Site check) | CSRF protection on every POST | Hidden form tokens | [node-hono-drizzle.md](research/node-hono-drizzle.md) |
| Hono 4.13 | `hono/secure-headers` (incl. `NONCE`, `Referrer-Policy: no-referrer`) | Security headers; keeping tokens out of `Referer` | Hand-set headers | [node-hono-drizzle.md](research/node-hono-drizzle.md) |
| Hono 4.13 | `hono/html` tagged template | Escaped server-side HTML | String concatenation, a template engine | [node-hono-drizzle.md](research/node-hono-drizzle.md) |
| Hono 4.13 | `c.req.parseBody()`, `@hono/zod-validator` with an error hook | Form parsing and validation that re-renders with errors | Manual body parsing | [node-hono-drizzle.md](research/node-hono-drizzle.md) |
| Hono 4.13 | `app.onError`, `app.notFound`, `HTTPException` | One error page and one not-found page | try/catch in every route | [node-hono-drizzle.md](research/node-hono-drizzle.md) |
| Hono 4.13 | `app.request()` | Route tests without a server | supertest, a live port | [node-hono-drizzle.md](research/node-hono-drizzle.md) |
| Drizzle 0.45.4 | `onConflictDoUpdate` (target `[planId, emailNormalized]`) | "Same email updates the name" (FR013) | Select-then-insert | [node-hono-drizzle.md](research/node-hono-drizzle.md) |
| Drizzle 0.45.4 | `db.transaction`, `.for('update')` | Atomic commit and confirm, call-off, deadline resolve | Application locks | [node-hono-drizzle.md](research/node-hono-drizzle.md) |
| drizzle-kit 0.31.11 | `generate` + `migrate(db, { migrationsFolder })` | Schema migrations | Hand-written SQL runner | [node-hono-drizzle.md](research/node-hono-drizzle.md) |
| Fly.io | `release_command` | Running migrations before each deploy; a failure stops the deploy | Migrating on boot | [fly-and-neon.md](research/fly-and-neon.md) |
| Fly.io | Secrets (`fly secrets set`), exposed as env vars | All four secrets in production | `.env` files on the server | [fly-and-neon.md](research/fly-and-neon.md) |
| Fly.io | `[[http_service.checks]]`, `fly certs add` (Let's Encrypt), `fly logs` | Health, HTTPS, logs | Self-managed TLS, log shipping | [fly-and-neon.md](research/fly-and-neon.md) |
| Neon | Branching | A throwaway database per developer or test run, if wanted | Seeding a separate server | [fly-and-neon.md](research/fly-and-neon.md) |

**Not used, and why**:
- Temporal **Workflow Update**, **Update-With-Start** and **Queries**: Postgres owns state, so commits don't round-trip through the workflow ([ADR 0002](../../docs/adr/0002-postgres-owns-state-temporal-owns-time.md)).
- Temporal **Worker Versioning**: needs deployment-pipeline setup; `patched()` is enough for a PoC.
- Resend **scheduled sending** (`scheduledAt`): Temporal timers keep the time, and calling a plan off would mean cancelling stored email ids ([ADR 0001](../../docs/adr/0001-temporal-workflow-per-plan.md)).
- Anthropic **structured outputs** (`output_config.format`) and **forced `tool_choice`**: the first isn't documented as compatible with web search citations, and Sonnet 5.5 rejects the second ([ADR 0004](../../docs/adr/0004-suggestions-sonnet-web-search.md)).
- **hono/jsx**: needs `.tsx`, which Node's type stripping can't run without a build step. `hono/html` covers it.
- Fly **`[processes]` groups**: each group gets its own Machine, which would double the cost ([ADR 0003](../../docs/adr/0003-single-fly-machine.md)).
- Neon **pooled (`-pooler`) connection string**: one long-running process with a small `pg.Pool` doesn't need PgBouncer, and Neon advises against pooling on both sides.

---

## Novel Pattern: Postgres owns state, the workflow keeps time

**Purpose**: confirm, call off and email on time, exactly once, without the pages ever waiting on Temporal ([ADR 0002](../../docs/adr/0002-postgres-owns-state-temporal-owns-time.md)).

**Components**:

| Component | Responsibility | Location |
|-----------|---------------|----------|
| Plan operations | Every state change, as one Postgres transaction that locks the plan row (`SELECT … FOR UPDATE`) and appends to `events` | `src/domain/plans.ts` |
| Plan rules | Pure functions: default deadline, the schedule's UTC instants, the morning-reminder skip rule | `src/domain/plan-rules.ts` |
| Temporal client helpers | `startPlanWorkflow(plan)`, `signalPlan(planId, signal, arg)`; signal failures are logged, never shown to the user | `src/temporal/client.ts` |
| `planWorkflow` | Waits on timers and signals; calls activities; never decides state | `src/temporal/workflows.ts` |
| Activities | `resolveDeadline`, `sendToCommitters(kind)`, `sendToOne(kind, commitId)`, `sendCheckIn`; each re-reads Postgres | `src/temporal/activities.ts` |
| Send ledger | `sendOnce(kind, plan, commit)`: ledger row → Resend with idempotency key → mark sent | `src/email/send.ts` |

**Data flow (publish)**:
1. `POST /plans` validates the form, generates `planId` and tokens, and computes the **schedule** with JS `Temporal` in `America/Los_Angeles`: `deadlineAt`, `reminder24At` (gathering − 24h), `reminderMorningAt` (08:00 on the gathering day, or null if the gathering starts before 10:00) and `checkInAt` (10:00 the day after). Each is a UTC instant.
2. One transaction inserts the plan (state `open`), the creator's commit, a `manage_link` ledger row and the `plan.published` and `commit.added` events.
3. It starts `planWorkflow` with workflow ID `plan-<planId>` and the schedule as its input. If the start fails, the request fails with the system-error page and the transaction is rolled back. Order: transaction open → start workflow → commit. A workflow whose plan row doesn't exist ends at its first activity.
4. It sends the manage-link email through `sendOnce` in the request (not the workflow), then redirects 303 to `/m/:manageToken/published`.

**Data flow (commit)**:
1. `POST /p/:token/commit` → transaction: lock the plan row. Reject if called off, if past the deadline while still open, or if the gathering has started (FR015). Upsert the commit on `(plan_id, email_normalized)` (FR013), clearing `withdrawn_at`. If the plan is `open` and the active count ≥ minimum and now < deadline, set `confirmed` and append `plan.confirmed`.
2. After commit: if this commit confirmed the plan, signal `confirmed`. If the plan was already confirmed and this commit is new, signal `committed(commitId)`.
3. Redirect 303 to the plan page with the notice.

**Workflow (`planWorkflow(input)`)**:

```
open ──(signal confirmed)──────────────────────▶ confirmed
open ──(deadline timer → resolveDeadline)──────▶ confirmed | called_off
open | confirmed ──(signal calledOff)──────────▶ called_off
confirmed ──(timers)──▶ reminder24 ▶ reminderMorning ▶ checkIn ▶ end
called_off ──▶ sendToCommitters("not_this_time") ▶ end
```

1. **Open phase**: `await condition(() => confirmed || calledOff, deadlineAt − now)`. On timeout, call `resolveDeadline(planId)`: a conditional update that moves `open → called_off` only if the active count < minimum, then returns the plan's real state. A commit that confirmed the plan in the same instant wins through the row lock.
2. **Confirmed**: `sendToCommitters("confirmed")`. Then, for each of `reminder24At`, `reminderMorningAt` and `checkInAt` that is still in the future, wait on a timer. While waiting, handle `committed(commitId)` with `sendToOne("confirmed", commitId)` and `calledOff` with the called-off path. The morning reminder is also skipped if the 24h reminder actually went out less than 6h before it (FR021); the workflow records when the 24h reminder was sent.
3. **Called off**: `sendToCommitters("not_this_time")`, then end. No more timers.
4. After the gathering starts, a `calledOff` signal is ignored; the call-off route rejects it anyway (FR023).

**Implementation Guide** (stories implementing this MUST):
1. Change plan or commit state only in `src/domain/plans.ts`, inside a transaction that locks the plan row. Never change it from workflow code, and from activities only through those functions.
2. Treat signals as hints. Every activity re-reads Postgres. `sendToCommitters` sends only to commits with `withdrawn_at IS NULL`, and only if the plan's state still matches the email (no reminder unless `confirmed`; no `not_this_time` unless `called_off`).
3. Send every email through `sendOnce`. It inserts into `email_sends (commit_id, kind)` with `ON CONFLICT DO NOTHING`, returns if `sent_at` is set, sends with `idempotencyKey = "<kind>/<planId>/<commitId>"`, then sets `sent_at` and appends `email.sent`. Build the payload only from stored data, so a retry sends exactly the same payload.
4. Activity options: `startToCloseTimeout: "30s"`, `scheduleToCloseTimeout: "12h"` (well inside Resend's 24h key window), `retry: { initialInterval: "5s", backoffCoefficient: 2, maximumInterval: "10m" }`.
5. Workflow code imports only `@temporalio/workflow` and types. Compute the schedule outside the workflow and pass it in as epoch milliseconds; don't use `Intl` or JS `Temporal` inside the workflow. Waits are `instant − Date.now()` (deterministic inside workflows), floored at 0.
6. Any change to `planWorkflow` once plans are live goes behind `patched("<change-id>")`, with a replay test against a recorded history.
7. Withdrawals need no signal: emails read the active commits when they're sent.

**Affects Epics**: 1 (publish/start), 2 (commit, withdraw), 3 (all), 4 (check-in).

---

## Implementation Patterns

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Routes | Short, lowercase, kebab-case; token as the only path parameter | `/p/:token`, `/m/:token/call-off` |
| Database tables | Plural, snake_case | `plans`, `commits`, `email_sends`, `check_in_answers`, `events` |
| Database columns | snake_case; times end in `_at` | `commit_deadline_at`, `withdrawn_at` |
| Drizzle schema fields | camelCase mapped to snake_case | `commitDeadlineAt` |
| Files | kebab-case `.ts` | `plan-rules.ts`, `seat-row.ts` |
| View functions | camelCase, ending in `Page` or naming the part | `planPage()`, `seatRow()` |
| Temporal | Workflow `planWorkflow`; workflow ID `plan-<planId>`; task queue `calvin`; signals camelCase | `confirmed`, `committed`, `calledOff` |
| Email kinds | snake_case string union | `manage_link`, `confirmed`, `reminder_24h`, `reminder_morning`, `not_this_time`, `check_in` |
| Event types | `noun.verb_past` | `plan.published`, `commit.added`, `commit.withdrawn`, `plan.confirmed`, `plan.called_off`, `email.sent`, `suggestion.requested`, `check_in.answered` |
| Env vars | SCREAMING_SNAKE_CASE | `BASE_URL` |
| Tests | `*.test.ts` next to source; cross-module in `tests/` | `plan-rules.test.ts` |
| Domain words | Use GLOSSARY.md terms in code and copy | `commit`, `withdraw`, `minimum`, `commitDeadline`, `calledOff`; never `rsvp`, `event` (for a plan), `cancel` |

### Code Organization
- **Routes stay thin**: parse and validate → call a `domain/` function → render a view or redirect 303. No SQL in routes or views.
- **Views are pure functions** of data to `html` template output. They do no I/O and never receive an email address for any page but the manage page (where none is shown either).
- **Plan rules are pure** and get the current instant as an argument (no hidden `Date.now()`), so tests pin time.
- **No JSON API.** Every endpoint returns HTML or a redirect. `create.js` only enhances (spinner text, copy, share) and posts the same forms.

### Error Handling
- **Field errors**: the zod validator hook re-renders the same page with inline messages (UX §8.2) and HTTP 422. Nothing entered is cleared.
- **Not found / bad token**: `app.notFound` and any lookup miss render the same "We can't find that plan" page with 404, whatever the token type (UX §8.6).
- **Suggestion failure** (timeout, API error, no `propose_plan` call, `pause_turn`, `refusal`, `max_tokens`): log it at `warn`, record a `suggestion.requested` event with `outcome: "failed"`, and render the fallback card (FR004). Never a 5xx.
- **Unexpected errors**: `app.onError` logs at `error` with the request id and renders a plain "Something went wrong, try again" page with 500. Stack traces never reach the page.
- **Temporal signal failure after a committed transaction**: log at `error` and carry on. The user's commit stands (ADR 0002).
- **Activities** throw on failure so Temporal retries. Non-retryable cases (Resend validation, auth or quota errors) throw `ApplicationFailure.nonRetryable`.

### Logging Strategy
- `src/log.ts` writes one JSON object per line to stdout: `{ level, msg, time, requestId?, planId?, ...context }`. Fly collects stdout (`fly logs`, 7 days).
- Levels: `error` for unexpected failures, `warn` for recoverable ones (suggestion fallback, signal failure), `info` for state changes and emails sent, `debug` off in production.
- **Never log** email addresses, tokens or secrets. The request logger replaces every path segment after `/p/`, `/m/`, `/w/` and `/c/` with `:token`. Log plans by `planId` (an internal UUID, never shown in URLs).

---

## Consistency Rules

### Date/Time Handling
- **Storage**: `timestamp with time zone` for every time column (`timestamp({ withTimezone: true })`), always UTC instants.
- **Zone**: `America/Los_Angeles` for every plan (a constant, `PLAN_TIME_ZONE`). All local-time rules (08:00, 10:00, the default deadline, form input) go through `src/domain/time.ts` with JS `Temporal.ZonedDateTime`. No other date library.
- **Form input**: `<input type="date">` + `<input type="time">` are read as a wall-clock time in `PLAN_TIME_ZONE`, using `disambiguation: "compatible"`.
- **Display**: through helpers in `time.ts` only, in UX §8.8 formats: `Sat 9 Nov · 10:00 AM`, `Thu 7 Nov, 10:00 AM`, plus relative hints.

### Validation Pattern
- One zod schema per form in `src/web/forms.ts`, applied with `zValidator('form', schema, hook)`.
- Emails: trimmed. `email_normalized` is the lowercased form and is the dedupe key. Names: trimmed, 1–80 chars; display uses the first word, capped at 16 chars (UX §10.2).
- Minimum: integer ≥ 2. Deadline: in the future and before the gathering (FR007). City: one of `CITIES`.

### Configured cities (FR001)
`CITIES` in `src/config.ts`, in this order: San Francisco, Oakland, Berkeley, Alameda, Emeryville, Daly City, San Mateo, Redwood City, Palo Alto, Mountain View, Sunnyvale, Santa Clara, San Jose, Fremont, Walnut Creek. All use `America/Los_Angeles`.

---

## Data Architecture

*Outline only; the data stage designs the schema in full.*

```
plans
├── id: uuid (PK)
├── public_token, manage_token, check_in_token: text (unique, 256-bit base64url)
├── city, area, time_window: text          # creator's inputs
├── format, venue: text
├── gathering_at, commit_deadline_at: timestamptz
├── minimum: integer (≥ 2)
├── state: text ('open' | 'confirmed' | 'called_off')
├── called_off_reason: text null ('deadline' | 'creator')
├── confirmed_at, called_off_at: timestamptz null
├── from_plan_id: uuid null (FK → plans)   # "start a new plan from this"
├── suggestion_edited: boolean             # FR029
└── created_at

commits
├── id: uuid (PK), plan_id (FK), name, email, email_normalized
├── is_creator: boolean, withdraw_token: text (unique)
├── withdrawn_at: timestamptz null
├── created_at, updated_at
└── unique (plan_id, email_normalized)

email_sends    (commit_id FK, kind, sent_at null, resend_id null, created_at; unique (commit_id, kind))
check_in_answers (plan_id FK, question 'happened' | 'attended', answer boolean, answered_at; unique (plan_id, question))
events         (id, plan_id null, type, data jsonb, created_at)   # append-only, FR029
```

| From | To | Type | Description |
|------|-----|------|-------------|
| plans | commits | 1:N | The creator's commit is the first |
| commits | email_sends | 1:N | One row per email kind per committer |
| plans | check_in_answers | 1:N (≤ 2) | One per question |
| plans | plans | 1:N | `from_plan_id` |
| plans | events | 1:N | The trial's metrics come from here |

---

## API Contracts

*No JSON API: these are HTML routes. The API stage writes each one's form fields, responses and redirects in full.*

| Method | Path | Purpose | Result |
|--------|------|---------|--------|
| GET | `/` | Create page | HTML |
| POST | `/suggest` | Get or replace a suggestion (`city`, `area`, `timeWindow`) | Create page with suggestion card or fallback |
| POST | `/plans` | Publish | 303 → `/m/:manageToken/published` |
| GET | `/m/:token/published` | Published screen | HTML |
| GET | `/p/:token` | Public plan page (with OG tags) | HTML |
| POST | `/p/:token/commit` | Commit (`name`, `email`) | 303 → `/p/:token?notice=…` |
| GET | `/m/:token` | Manage page | HTML (`noindex`) |
| POST | `/m/:token/call-off` | Call off | 303 → `/m/:token` |
| GET | `/m/:token/new` | Create page pre-filled from the plan (FR025) | HTML |
| GET | `/w/:token` | Withdraw confirmation | HTML (`noindex`) |
| POST | `/w/:token` | Withdraw | 303 → `/w/:token?done=1` |
| GET | `/c/:token/:question/:answer` | Record a check-in answer (`happened`/`attended`, `yes`/`no`) | HTML thank-you (`noindex`) |
| GET | `/healthz` | Fly health check | 200 `ok` |
| GET | `/static/*` | `app.css`, `create.js`, `og.png` (cache headers) | Files |

The post-commit notice in the query string carries no email address (NFR006).

---

## Security Architecture

PoC gate: **secrets hygiene**.

### Secrets

| Secret | Where it lives | How it reaches the code |
|--------|----------------|-------------------------|
| `ANTHROPIC_API_KEY` | Production: Fly secrets. Local: `.env` (gitignored) | Environment variable, read by the Anthropic SDK |
| `RESEND_API_KEY` (sending access only, restricted to calvin's domain) | Fly secrets / local `.env` | Environment variable, read by the Resend SDK |
| `TEMPORAL_API_KEY` | Fly secrets / local `.env` (unset for the local dev server) | Environment variable, read by `@temporalio/envconfig` |
| `DATABASE_URL` (contains the Neon password) | Fly secrets / local `.env` | Environment variable, read in `src/config.ts` |

Rules:
- Secrets are set with `fly secrets set` (interactive or from stdin), never written in `fly.toml`, the Dockerfile, the repo, a log line or a CI command line. `.env` is in `.gitignore`. `.env.example` lists names only.
- `src/config.ts` validates that each secret is present at startup and never prints values. Errors name the missing variable only.
- Tokens in URLs are capabilities. The logger redacts them (Logging Strategy), and `Referrer-Policy: no-referrer` stops them leaking to venue or map links.

---

## Performance Considerations

| Concern | Strategy |
|---------|----------|
| Public page ≤ 2s over 4G | Server-rendered HTML, one CSS file < 10 KB, no JS, no web fonts; one query for the plan plus its commits |
| Neon cold start | Accept a few hundred ms after 5 idle minutes; `connectionTimeoutMillis: 5000` and one retry on connect |
| Neon in Oregon, Fly in sjc | Keep each page to one or two round trips |
| Suggestion ≤ 15s p95 | `max_uses: 2`, `effort: "low"`; measure in the first suggestion story and drop to `max_uses: 1` if needed |
| Static assets | `Cache-Control: public, max-age=86400` on `/static/*` |

---

## Deployment Architecture

### Environments

| Environment | Purpose | URL |
|-------------|---------|-----|
| Development | Local: `node --env-file=.env --watch src/main.ts`, `temporal server start-dev`, a Neon dev branch or local Postgres | `http://localhost:8080` |
| Production | The trial | `https://<calvin domain>` (operator to choose; also the Resend sending domain's parent) |

There's no staging at PoC maturity.

### Infrastructure

```
Phone (chat in-app browser) ──HTTPS──▶ Fly proxy ──▶ Fly Machine sjc (Node 26, one process)
                                                      ├─ Hono web ───────────────┐
                                                      ├─ Temporal worker ◀─poll──┼──▶ Temporal Cloud (operator's namespace)
                                                      │      └─ activities ──────┤
                                                      ├──────────────────────────┴──▶ Neon Postgres (aws-us-west-2)
                                                      ├──▶ Anthropic API (suggestions)
                                                      └──▶ Resend (email) ──▶ inboxes
```

Estimated cost: Fly about $4.40, Neon $0, Temporal Cloud negligible (about 100 actions per plan on the existing account), Resend Free (100/day, 3,000/month), Anthropic about $0.05–0.07 per suggestion. About $5/month.

---

## Development Environment

### Prerequisites
- Node.js 26
- Temporal CLI (`temporal server start-dev`)
- A Postgres database: a Neon dev branch, or local Postgres
- `flyctl` (deploys only)

### Setup Commands

```bash
npm ci
cp .env.example .env          # fill in values locally; never commit .env
npx drizzle-kit migrate
temporal server start-dev     # separate terminal; UI at http://localhost:8233
node --env-file=.env --watch src/main.ts
npx vitest
```

### Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `BASE_URL` | Absolute URL for links in emails and the CSRF origin | Yes |
| `PORT` | HTTP port (default 8080) | No |
| `DATABASE_URL` | Neon direct connection string | Yes (secret) |
| `ANTHROPIC_API_KEY` | Suggestions | Yes (secret) |
| `ANTHROPIC_MODEL` | Default `claude-sonnet-5-5` | No |
| `RESEND_API_KEY` | Email | Yes (secret) |
| `EMAIL_FROM` | e.g. `calvin <plans@send.<domain>>` | Yes |
| `TEMPORAL_ADDRESS` | `<ns>.<acct>.tmprl.cloud:7233`, or `localhost:7233` | Yes |
| `TEMPORAL_NAMESPACE` | `<ns>.<acct>`, or `default` | Yes |
| `TEMPORAL_API_KEY` | Temporal Cloud auth | In production (secret) |

---

## Open Items for the Operator

- **Domain**: pick calvin's domain, then verify the `send.` subdomain in Resend (SPF and DKIM records, plus a `_dmarc` TXT with `p=none`).
- **Temporal Cloud**: create a namespace (e.g. `calvin`) and an API key scoped to it.

---

## Architecture Decision Records

- [0001: One Temporal Cloud workflow per plan keeps the plan's time](../../docs/adr/0001-temporal-workflow-per-plan.md): durable timers instead of a cron sweep; Resend scheduled sending not used.
- [0002: Postgres owns plan state; the workflow only keeps time](../../docs/adr/0002-postgres-owns-state-temporal-owns-time.md): signals as wake-ups, a send ledger for exactly-once email; Updates and Queries not used.
- [0003: One always-on Fly.io machine runs web and worker in one process](../../docs/adr/0003-single-fly-machine.md): autostop off, no process groups.
- [0004: Plan suggestions use Sonnet 5.5 with web search and a strict `propose_plan` tool](../../docs/adr/0004-suggestions-sonnet-web-search.md): venues checked as real; latency to be measured.

---

*Architecture document generated for calvin*
*Date: 2026-10-27*
