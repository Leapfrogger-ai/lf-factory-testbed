# Manage-link email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email the creator their private manage link when a plan is published, through a `sendEmail` wrapper and a `sendOnce` ledger that every later email will reuse.

**Architecture:** `src/email/send-email.ts` wraps Resend's `emails.send` and turns `{ data, error }` into a return value or a classified thrown error. `src/email/send.ts` holds `sendOnce` (ledger row, send, mark sent, `email.sent` event) and the plain-text payload builder. `POST /plans` calls `sendOnce` after `publish()`'s transaction, catches and logs a failure, and always redirects 303. The published screen reads the ledger to pick its copy.

**Tech Stack:** TypeScript on Node 26, Hono, Drizzle + Postgres, Resend SDK 6, `@temporalio/activity`'s `ApplicationFailure`, Vitest.

**Spec:** .factory/story.md (story #128)

## Global Constraints

- Use Resend's idempotency keys (`emails.send(payload, { idempotencyKey })`) so a retried activity doesn't re-send; don't hand-roll send-then-check — [finding](specs/calvin/research/resend.md).
- Use Resend's tags (`{ name: "kind", value: <kind> }`) to mark each email's kind — [finding](specs/calvin/research/resend.md).
- Every email is sent through `sendOnce`, with its payload built only from stored data — that's what makes each email go out exactly once and a retry identical. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md), [ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address — SQL and I/O stay in one module, and NFR006 holds by construction.
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed in. ([test-strategy](specs/calvin/test-strategy.md))
- Times are stored as UTC `timestamptz`, and every local-time rule and display format goes through `src/domain/time.ts` with `PLAN_TIME_ZONE` — one place for DST and the UX §8.8 formats.
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities. ([ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Environment variables are read only in `src/config.ts` (and `DATABASE_URL` in `src/db/migrate.ts`), validated with zod at startup — one place says what the app needs.
- No secret is read, stored, logged or committed other than as the architecture's Secrets table says (env vars from Fly secrets or a gitignored `.env`; never in `fly.toml`, the Dockerfile, the repo, a log line or a CI command line; `.env.example` holds names only) — a leaked secret can't be taken back.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- Every DST-sensitive rule has a test on 2026-11-01 and 2027-03-14 in `America/Los_Angeles` — that's where local-time rules break.
- Exactly-once email is: insert a ledger row if there isn't one, send with Resend `idempotencyKey = <kind>/<planId>/<commitId>` only if the row isn't marked sent, then mark it sent. Activity retries are capped below Resend's 24h key window.
- **Configuration**: sending-only API key restricted to calvin's sending domain. Emails are sent with `text` only (UX §8.9: plain, text-first), a `tags: [{ name: "kind", value: <kind> }]` entry and `idempotencyKey`. The SDK returns `{ data, error }` instead of throwing, so `email/send.ts` turns errors into thrown errors: retryable for `rate_limit_exceeded`, 409 `concurrent_idempotent_requests` and 5xx; `ApplicationFailure.nonRetryable` for validation, auth and quota errors.
- Send every email through `sendOnce`. It inserts into `email_sends (commit_id, kind)` with `ON CONFLICT DO NOTHING`, returns if `sent_at` is set, sends with `idempotencyKey = "<kind>/<planId>/<commitId>"`, then sets `sent_at` and appends `email.sent`. Build the payload only from stored data, so a retry sends exactly the same payload.
- | App port (manual dev runs only; tests use `app.request()`) | `FACTORY_PORT_BASE + 0` (default 8080) |
- | Postgres server | the test run's own, started by `embedded-postgres` on `127.0.0.1:${FACTORY_PORT_BASE + 2}` (default 20002), user `postgres`, password `calvin`, data in the worktree's `.factory/pgdata` |
- | Test database | `FACTORY_DB_NAME` on that server (default `calvin_test`) |

Binding: CODING_STANDARDS.md, GLOSSARY.md, docs/adr/0002-postgres-owns-state-temporal-owns-time.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md, specs/calvin-2/architecture.md, specs/calvin-2/test-strategy.md

## Review Focus

- A failure message that carries the creator's address (`Error('bounce for ann@example.test')`): the publish log line still has no address. Pinned in Task 4.
- Two `sendOnce` calls racing for the same commit and kind: one `email.sent` event, one ledger row. Pinned in Task 3.
- Resend answering with `statusCode: null` (a network failure): retryable, since it's transient. Pinned in Task 2.
- A venue or format with `&`, `<` or quotes: it appears verbatim in the text body, never HTML-escaped. Pinned in Task 3.
- `sendEmail` failing non-retryably (`ApplicationFailure.nonRetryable`) in the publish request: still a 303 and the published screen. Pinned in Task 4.

---

### Task 1: `formatDay` for the subject line

**Covers:** AC1

**Files:**
- Modify: `src/domain/time.ts`
- Test: `src/domain/time.test.ts`

**Interfaces:**
- Produces: `formatDay(instant: Temporal.Instant): string` — the UX §8.8 day part, e.g. `Sat 14 Nov`, in `PLAN_TIME_ZONE`.

- [ ] **Step 1: Write the failing tests** in `src/domain/time.test.ts`, in a `describe('formatDay')`:
  - `formatDay(Temporal.Instant.from('2026-11-14T18:00:00Z'))` is `'Sat 14 Nov'`.
  - 2026-11-01 (fall back): `'2026-11-01T08:30:00Z'` (1:30 AM PDT) is `'Sun 1 Nov'`, and `'2026-11-01T09:30:00Z'` (1:30 AM PST, the repeated hour) is also `'Sun 1 Nov'`.
  - 2027-03-14 (spring forward): `'2027-03-14T11:00:00Z'` (4:00 AM PDT) is `'Sun 14 Mar'`.
  - Late evening crosses UTC midnight: `'2026-11-15T07:30:00Z'` (11:30 PM PST) is `'Sat 14 Nov'`.
- [ ] **Step 2: Run** `npx vitest run src/domain/time.test.ts` — expect FAIL, `formatDay` is not exported.
- [ ] **Step 3: Implement** `formatDay` in `src/domain/time.ts`, returning `displayParts(instant).day`.
- [ ] **Step 4: Run** `npx vitest run src/domain/time.test.ts` — expect PASS.
- [ ] **Step 5: Commit** — `git add src/domain/time.ts src/domain/time.test.ts && git commit -m "Time: add formatDay for email subjects"`

### Task 2: `sendEmail`, the Resend wrapper

**Covers:** AC6

**Files:**
- Create: `src/email/send-email.ts`
- Test: `src/email/send-email.test.ts`

**Interfaces:**
- Produces:
  - `type EmailPayload = { to: string; subject: string; text: string; tags: { name: string; value: string }[] }`
  - `type SendEmail = (payload: EmailPayload, idempotencyKey: string) => Promise<{ id: string }>`
  - `type ResendLike = { emails: { send(payload: EmailPayload & { from: string }, options: { idempotencyKey: string }): Promise<{ data: { id: string } | null; error: { name: string; message: string; statusCode: number | null } | null }> } }`
  - `createSendEmail(deps: { resend: ResendLike; from: string }): SendEmail` — adds `from` to the payload, passes `{ idempotencyKey }`, returns `{ id }` from `data`.
  - Errors: retryable (`ApplicationFailure.retryable`) when `error.name` is `rate_limit_exceeded` or `concurrent_idempotent_requests`, when `statusCode >= 500`, or when `statusCode` is `null`; every other error is `ApplicationFailure.nonRetryable`. Import `ApplicationFailure` from `@temporalio/activity`. The error message must not include the payload.

- [ ] **Step 1: Write the failing tests.** Use a hand-written `ResendLike` fake that records its arguments and answers with a canned result (the Resend client is the system boundary).
  - Success: `createSendEmail({ resend, from: 'calvin <hi@send.calvin.test>' })(payload, 'manage_link/p/c')` resolves `{ id: 'abc' }`, and the fake saw `from`, the payload's `to`, `subject`, `text` and `tags`, and `{ idempotencyKey: 'manage_link/p/c' }`.
  - Retryable (`rejects` with an `ApplicationFailure` whose `nonRetryable` is `false`): `rate_limit_exceeded`/429, `concurrent_idempotent_requests`/409, `application_error`/500, `service_unavailable`/503, and `application_error`/`null` (Review Focus).
  - Non-retryable (`nonRetryable` is `true`): `validation_error`/422, `invalid_api_key`/403, `restricted_api_key`/401, `daily_quota_exceeded`/429, `monthly_quota_exceeded`/429.
- [ ] **Step 2: Run** `npx vitest run src/email/send-email.test.ts` — expect FAIL, module not found.
- [ ] **Step 3: Implement** `src/email/send-email.ts` as specified above.
- [ ] **Step 4: Run** `npx vitest run src/email/send-email.test.ts` — expect PASS.
- [ ] **Step 5: Commit** — `git add src/email && git commit -m "Email: add sendEmail, the Resend wrapper"`

### Task 3: `sendOnce` and the manage-link payload

**Covers:** AC1, AC4, AC5

**Files:**
- Create: `src/email/send.ts`
- Modify: `src/domain/plans.ts` (`publish` returns `creatorCommitId`; add `loadSendTarget`), `src/web/app.ts` (`AppDeps.sendEmail: SendEmail`), `tests/support/fakes.ts` (`fakeEmail` records `attempts`)
- Test: `src/email/send.test.ts`

**Interfaces:**
- Consumes: `SendEmail`, `EmailPayload` (Task 2); `formatDay` (Task 1); `appendEvent` from `src/domain/events.ts`; `emailSends` from `src/db/schema.ts`.
- Produces:
  - `publish(...)` now resolves `{ planId, publicToken, manageToken, creatorCommitId }`.
  - `type PlanRow = typeof plans.$inferSelect`, `type CommitRow = typeof commits.$inferSelect` (exported from `src/domain/plans.ts`).
  - `loadSendTarget(db: Db, planId: string): Promise<{ plan: PlanRow; commit: CommitRow }>` — the plan and its creator's commit.
  - `sendOnce(deps: { db: Db; sendEmail: SendEmail; baseUrl: string }, kind: EmailKind, plan: PlanRow, commit: CommitRow): Promise<void>` in `src/email/send.ts`, with `EmailKind = typeof emailSends.$inferSelect['kind']`. Flow: insert `(commitId, kind)` with `onConflictDoNothing`; return if that row's `sentAt` is set; call `sendEmail(payload, \`${kind}/${plan.id}/${commit.id}\`)` with tag `{ name: 'kind', value: kind }`; then in one transaction `update … set resendId, sentAt = now() where commitId, kind and sentAt is null returning`, and only if a row came back `appendEvent(tx, { planId, commitId, type: 'email.sent', data: { kind, resendId } })`. A send error propagates and leaves the row unsent. The database sets `sent_at`, so `sendOnce` doesn't need a clock.
  - `buildPayload(kind, plan, commit, baseUrl): EmailPayload` (same file, not exported): for `manage_link`, `to` is `commit.email`, subject `Your plan: <Format capitalised> at <venue>, <formatDay(gatheringAt)>`, and a text body from UX §8.9 saying: here's your private link to see who's in or call it off, don't share it, the manage link `${baseUrl}/m/${plan.manageToken}`, and "Paste this one in your chat:" followed by `${baseUrl}/p/${plan.publicToken}`. No withdraw link, no HTML. Any other kind throws `Error('No email template for <kind>')` until its story adds one.

- [ ] **Step 1: Write the failing tests** in `src/email/send.test.ts` (DB reset in `beforeEach`; plan from `publishPlan(testDeps())`, target from `loadSendTarget`, `baseUrl` `TEST_BASE_URL`). First extend `fakeEmail` so `attempts` records every call, failed ones too, and `calls` stays successful-only.
  - AC1: one call, `fakes.email.calls[0]` has `payload.to === 'ann@example.test'`, subject `'Your plan: Coffee at Blue Bottle, Sat 14 Nov'`, `tags` equal to `[{ name: 'kind', value: 'manage_link' }]`, idempotency key `manage_link/${planId}/${creatorCommitId}`, a text body containing `https://calvin.test/m/${manageToken}` and `https://calvin.test/p/${publicToken}`, not matching `/withdraw/i`, and the payload has no `html` property.
  - AC4: call `sendOnce` twice for the same kind and commit; `fakes.email.calls` has length 1, `email_sends` has one row with `sent_at` set and `resend_id` `'email-1'`, and `events` has exactly one `email.sent` with `data` `{ kind: 'manage_link', resendId: 'email-1' }`.
  - AC5: `failNext()`, first call rejects, ledger row exists with `sent_at` null; second call succeeds; `attempts` has length 2 and `attempts[1]` `toEqual` `attempts[0]` (same payload and key).
  - Review Focus: `Promise.all` of two `sendOnce` calls for one commit yields one `email_sends` row and one `email.sent` event.
  - Review Focus: a plan with venue `'Fish & Chips <b>"Co"</b>'` has that venue verbatim in `text` and in the subject.
- [ ] **Step 2: Run** `npx vitest run src/email/send.test.ts` — expect FAIL, module not found.
- [ ] **Step 3: Implement** `sendOnce` and `buildPayload` in `src/email/send.ts`; `loadSendTarget` and the `creatorCommitId` return in `src/domain/plans.ts`; change `AppDeps.sendEmail` to `SendEmail` in `src/web/app.ts` and fix any type error `npx tsc --noEmit` reports.
- [ ] **Step 4: Run** `npx vitest run src/email/send.test.ts src/domain && npx tsc --noEmit` — expect PASS.
- [ ] **Step 5: Commit** — `git add src tests && git commit -m "Email: add sendOnce and the manage-link payload"`

### Task 4: Send on publish and show the right published screen

**Covers:** AC1, AC2, AC3

**Files:**
- Modify: `src/web/routes/create.ts` (`createRoutes(deps, config)`), `src/web/app.ts` (pass `config`), `src/domain/plans.ts` (`PlanView.manageLinkSent: boolean` from the creator's `email_sends` row for `manage_link` having `sent_at`), `src/web/routes/manage.ts`, `src/web/views/published-page.ts` (`PublishedLinks` gains `emailed: boolean`), `src/main.ts`
- Test: `src/web/routes/create.test.ts`, `src/web/routes/manage.test.ts`

**Interfaces:**
- Consumes: `sendOnce`, `loadSendTarget`, `publish(...).creatorCommitId` (Task 3); `createSendEmail` (Task 2).
- Produces: `publishedPage({ publicLink, manageLink, emailed })` renders "We've emailed you a private link to manage the plan. Keep it to yourself." when `emailed`, else "We couldn't email you your private link. Bookmark the link below to manage the plan.".

- [ ] **Step 1: Write the failing tests** (through `createApp(deps, { baseUrl: TEST_BASE_URL })` and `app.request`, as the existing tests do).
  - `create.test.ts`, AC1: after `POST /plans` with `planForm()`, `fakes.email.calls` has length 1 and its idempotency key matches `^manage_link/<uuid>/<uuid>$`, `payload.to` is `ann@example.test`, and the text has `https://calvin.test/m/<token from the redirect>`.
  - `create.test.ts`, AC3: with `failNext()`, the response is 303 to `/m/<token>/published`, and `GET` of that location contains "We couldn't email you your private link. Bookmark the link below to manage the plan.". Capture log output with `vi.spyOn(process.stdout, 'write')`; one line has `level` `error`, contains the `planId`, and doesn't contain `ann@example.test`.
  - `create.test.ts`, Review Focus: `sendEmail` rejecting with `new Error('bounce for ann@example.test')` leaves no log line containing the address, and `sendEmail` rejecting with `ApplicationFailure.nonRetryable('bad')` still gives 303.
  - `manage.test.ts`, AC2: publishing through `POST /plans` and then `GET /m/<token>/published` contains "We've emailed you a private link to manage the plan. Keep it to yourself." and not the failure copy. The existing test that publishes with `publishPlan` (no email sent) asserts the failure copy.
- [ ] **Step 2: Run** `npx vitest run src/web` — expect FAIL on the new assertions.
- [ ] **Step 3: Implement.** In the `POST /plans` handler, after `publish()`, call `loadSendTarget` then `sendOnce({ db: deps.db, sendEmail: deps.sendEmail, baseUrl: config.baseUrl }, 'manage_link', plan, commit)` inside `try`/`catch`; on error `log.error('manage-link email failed', { planId, errorName: err.name })` (the name only, never the message), then redirect 303 as before. Add `manageLinkSent` to `loadPlan`, pass it as `emailed` in the manage route, and branch the copy in the view. In `src/main.ts` replace the `sendEmail` stub with `createSendEmail({ resend: new Resend(config.resendApiKey), from: config.emailFrom })`.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit` — expect all tests PASS and no type errors.
- [ ] **Step 5: Commit** — `git add src tests && git commit -m "Publish: email the creator their manage link"`

## Rulings

Ruling: `sendOnce` inserts the manage-link ledger row itself, after the publish transaction, not inside it as architecture.md's publish flow step 2 says — the story says `sendOnce` inserts the row and the email is sent after the transaction — if wrong, a crash between commit and send leaves no row, which the next `sendOnce` call creates anyway.
Ruling: `from` is added by `createSendEmail` from `EMAIL_FROM`, so `EmailPayload` has no `from` and the payload built by `sendOnce` holds stored data only — `EMAIL_FROM` already exists in `src/config.ts` and is an environment value, not plan data — if wrong, move `from` into the payload.
Ruling: a Resend error with `statusCode: null` is retryable — it's the SDK's shape for a network failure, which is transient — if wrong, a permanent failure retries until Temporal's activity timeout, 12 hours.
Ruling: the published screen decides its copy from the `email_sends` row's `sent_at`, not from a flag in the redirect — a reload of the screen then shows the same copy and no query string is needed — if wrong, the screen could say "emailed" for a later resend, which is still true.
Ruling: `sendOnce` handles only `manage_link` for now, and any other kind throws until its story adds a template — YAGNI, the story builds only the manage-link email — if wrong, a later story adds a case.
