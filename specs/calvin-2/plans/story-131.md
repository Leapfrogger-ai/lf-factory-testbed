# Rate limits on suggest and publish (story 1.9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /suggest` and `POST /plans` are capped per IP and per Los Angeles calendar day, answering 429 with `Retry-After` and the same page re-rendered with a notice, before validation, Claude or any database write.

**Architecture:** `src/web/rate-limit.ts` holds a pure in-memory fixed-window limiter (`createRateLimiter`) built per app in `createApp`, so each test app starts with empty counters. Each route gets a middleware, placed after CSRF and before `zValidator`, that identifies the client, counts the request and either continues or renders the route's 429 page. Limits are the `RATE_LIMITS` constant in `src/config.ts`.

**Tech Stack:** Node 26 (type stripping, JS `Temporal`), Hono + `@hono/node-server/conninfo`, Vitest 5.

**Spec:** .factory/story.md (story #131)

Acceptance criteria are numbered in the order of `.factory/story.md`: AC1 suggest per-IP limit (429, `Retry-After`, notice and fallback card, no Claude call, no row), AC2 suggest daily cap, AC3 publish per-IP limit (429, notice, entries kept, no plan), AC4 publish daily cap, AC5 another IP isn't limited, AC6 invalid requests count, AC7 limited requests log at `warn` without the IP.

## Global Constraints

- Use Hono's `app.request()` for route tests; don't add supertest or listen on a port — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Node 26's JS `Temporal` (`Temporal.ZonedDateTime` in `America/Los_Angeles`) for all local-time math; don't do manual offset math or add `date-fns-tz` or `luxon` — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine — [finding](specs/calvin/research/node-hono-drizzle.md).
- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address — SQL and I/O stay in one module, and NFR006 holds by construction.
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed in. ([test-strategy](specs/calvin/test-strategy.md))
- Times are stored as UTC `timestamptz`, and every local-time rule and display format goes through `src/domain/time.ts` with `PLAN_TIME_ZONE` — one place for DST and the UX §8.8 formats.
- Errors follow the architecture's Error Handling section: a field error re-renders the same page with 422 and keeps what was entered, any bad token is the same 404 page (a malformed one without a database query), a suggestion failure is a fallback card and never a 5xx, and anything unexpected goes to `app.onError` with no stack trace on the page — users never see a different error shape per route.
- Environment variables are read only in `src/config.ts` (and `DATABASE_URL` in `src/db/migrate.ts`), validated with zod at startup — one place says what the app needs.
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities. ([ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- Every DST-sensitive rule has a test on 2026-11-01 and 2027-03-14 in `America/Los_Angeles` — that's where local-time rules break.
- Operator decision (api-specification §4): in-memory counters on the single machine (ADR 0003), about 30 lines in `src/web/rate-limit.ts`, with no new dependency; fixed windows; a "day" is the calendar day in `America/Los_Angeles`; the limits are constants in `src/config.ts` (`RATE_LIMITS`); every request that passes CSRF counts, and the check runs before validation and before any Claude call or database write.
- Test database and ports come from the worktree: `FACTORY_PORT_BASE` (Postgres at `FACTORY_PORT_BASE + 2`) and `FACTORY_DB_NAME`, through `TEST_DATABASE_URL` built in `vitest.config.ts`; tests use `testDb()` and `resetDb()` and never read `.env`. ([test-strategy](specs/calvin-2/test-strategy.md))

Binding: CODING_STANDARDS.md, docs/adr/0003-single-fly-machine.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md, specs/calvin-2/test-strategy.md, specs/calvin-2/api-specification.md

## Review Focus

- A request with no `Fly-Client-IP` and no socket address (as in `app.request()`): it must still be counted under one shared key, never throw or skip the limit.
- An empty `Fly-Client-IP` header: treated as absent (falls back to the socket address, then the shared key).
- The window boundary: the request exactly at the reset instant starts a new window, and `Retry-After` is a whole number of seconds ≥ 1.
- The Los Angeles day rolling over on a DST change day (2026-11-01, 2027-03-14): the daily counter resets at local midnight, not at 00:00 UTC.
- A limited request with markup in its form values: the 429 page re-renders what was entered, HTML-escaped, and still never calls Claude or writes.

## Task 1: The limiter and its limits

**Covers:** AC2, AC4, AC5

**Files:**
- Create: `src/web/rate-limit.ts`, `src/web/rate-limit.test.ts`
- Modify: `src/config.ts`

**Interfaces:**
- Produces in `src/config.ts`: `export const RATE_LIMITS = { suggest: { perIp: { limit: 10, windowSeconds: 600 }, perDay: { limit: 200 } }, publish: { perIp: { limit: 3, windowSeconds: 3600 }, perDay: { limit: 50 } } } as const`.
- Produces in `src/web/rate-limit.ts`: `export type RateRoute = keyof typeof RATE_LIMITS`; `export type RateDecision = { limited: false } | { limited: true; retryAfterSeconds: number }`; `export type RateLimiter = { check(route: RateRoute, ip: string): RateDecision }`; `export function createRateLimiter(now: () => Temporal.Instant, limits = RATE_LIMITS): RateLimiter`.
- Consumes: `localOn(instant, hour, dayOffset)` and `localDateTime(instant)` from `src/domain/time.ts`.

- [ ] **Step 1: Write the failing test** `allows the limit and refuses the next` in `rate-limit.test.ts`. It passes a small `limits` argument (`suggest.perIp.limit: 2, windowSeconds: 600`, `perDay.limit: 100`, `publish` likewise) so the test doesn't restate production numbers, and a clock from `fixedClock` in `tests/support/fakes.ts`. Two `check('suggest', '1.1.1.1')` calls return `{ limited: false }`; the third returns `{ limited: true, retryAfterSeconds: 600 }`.
- [ ] **Step 2: Run** `npx vitest run src/web/rate-limit.test.ts` — Expected: FAIL, `createRateLimiter` not defined.
- [ ] **Step 3: Implement** `createRateLimiter` and `RATE_LIMITS`. Per-IP: a `Map` keyed `${route}:${ip}` of `{ windowEndsAt: Temporal.Instant, count }`; a window starts at the first request after the previous one ended and lasts `windowSeconds`. Every `check` increments both the IP counter and the route's day counter, limited or not (the spec counts every request); it is limited if either exceeds its limit. `retryAfterSeconds` is the largest remaining time among the exceeded windows, rounded up, minimum 1. The day counter is keyed by `localDateTime(now()).date` and resets at `localOn(now(), 0, 1)`. Drop expired entries on each call so the map doesn't grow.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Add tests one at a time, each RED then GREEN:**
  - `counts another IP separately` (AC5): `1.1.1.1` at its limit is refused, `2.2.2.2` isn't.
  - `starts a new window at the reset instant`: refused at `2026-11-09T18:00:00Z`, allowed at `2026-11-09T18:10:00Z` with a 600-second window.
  - `caps a route per day across IPs` (AC2, AC4): with `perDay.limit: 3` and four distinct IPs, the fourth is refused, for `suggest` and for `publish`; the other route's counter is untouched.
  - `rolls the day over at Los Angeles midnight`: a day counter exhausted at `2026-11-09T07:30:00Z` (23:30 PST on the 8th) has `retryAfterSeconds` 1800 and is clear at `2026-11-09T08:00:00Z`.
  - `a day is 25 hours when the clocks fall back` (2026-11-01): exhausted at `2026-11-01T07:00:00Z` (00:00 PDT), `retryAfterSeconds` is 90000 (next midnight is `2026-11-02T08:00:00Z`).
  - `a day is 23 hours when the clocks spring forward` (2027-03-14): exhausted at `2027-03-14T08:00:00Z` (00:00 PST), `retryAfterSeconds` is 82800 (next midnight is `2027-03-15T07:00:00Z`).
- [ ] **Step 6: Run** `npx vitest run src/web/rate-limit.test.ts && npx tsc --noEmit` — Expected: PASS.
- [ ] **Step 7: Commit** `git add src/config.ts src/web/rate-limit.ts src/web/rate-limit.test.ts && git commit -m "Add the in-memory rate limiter"`

## Task 2: Limit POST /suggest

**Covers:** AC1, AC2, AC5, AC6

**Files:**
- Create: `src/web/client-ip.ts`
- Modify: `src/web/app.ts`, `src/web/routes/create.ts`, `src/web/views/create-page.ts`
- Test: `src/web/routes/create.test.ts`

**Interfaces:**
- Consumes: `createRateLimiter`, `RateLimiter` (Task 1); `AppDeps.now`.
- Produces: `export function clientIp(c: Context): string` in `client-ip.ts`: the trimmed `Fly-Client-IP` header when non-empty, else the socket's remote address via `getConnInfo` from `@hono/node-server/conninfo` (in try/catch), else the literal `'unknown'`.
- Produces: `createRoutes(deps, config, limiter)` takes the limiter as a third argument; `createApp` builds one with `createRateLimiter(deps.now)` and passes it.
- Produces in `create-page.ts`: the `inputs` and `card` variants of `CreateState` gain the optional `notice?: string` that `fallback` already has, and the page renders `<p class="notice">` for all three. Exports `SUGGEST_LIMIT_NOTICE = 'Lots of suggestions just now. Fill in your own below, or try again in a few minutes.'` and `PUBLISH_LIMIT_NOTICE = 'Lots of plans from here just now. Try again in a little while.'`.

- [ ] **Step 1: Write the failing test** `answers 429 on the 11th suggestion from one IP (AC1)` in `create.test.ts`. Send 10 valid `POST /suggest` with header `Fly-Client-IP: 203.0.113.7` (each 303), then an 11th. Assert: status 429; `Retry-After` matches `/^\d+$/`; the body contains `SUGGEST_LIMIT_NOTICE`'s text; the body holds the fallback card (the publish form with the entered `city`, `area`, `timeWindow` and no `suggestionId` input); `fakes.suggest` was called 10 times, not 11; and the stored `suggestions` rows number 10 (use an existing count helper in `domain/suggestions.ts`, or add `countSuggestions(db)` beside `countPlans`).
- [ ] **Step 2: Run** `npx vitest run src/web/routes/create.test.ts -t "11th suggestion"` — Expected: FAIL (status 303).
- [ ] **Step 3: Implement** `clientIp`, the view's `notice` support, and a `limit(route, render429)` helper in `create.ts` returning a Hono middleware: `limiter.check(route, clientIp(c))`; if limited, set `Retry-After`, call `log.warn('rate limited', { route })` (no IP, nothing else from the request) and return `render429(c)`; otherwise `next()`. Register it on `/suggest` before `zValidator`. The suggest 429 renders `{ kind: 'fallback', values, notice: SUGGEST_LIMIT_NOTICE, city, area, timeWindow }` (from `enteredValues`; empty strings when absent) with status 429 in `layout('Suggest a plan', …)`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Add tests one at a time, each RED then GREEN:**
  - `answers 429 on the 201st suggestion of a Los Angeles day (AC2)`: 200 requests each from a distinct `Fly-Client-IP`, then a 201st from a new IP → 429 (fixed clock `2026-11-09T18:00:00Z`).
  - `does not limit another IP (AC5)`: after IP A's 11th is 429, IP B's first request is 303.
  - `counts invalid suggestions (AC6)`: 10 requests with an empty `city` (each 422) from one IP, then a valid one → 429 and `fakes.suggest` not called.
  - `shares one key without Fly-Client-IP`: 11 requests with no header → the 11th is 429; an empty `Fly-Client-IP:` header counts the same as an absent one.
  - `escapes what was entered on the 429 page`: a limited request with `area=<script>x</script>` renders it escaped, not as a live tag.
- [ ] **Step 6: Run** `npx vitest run src/web && npx tsc --noEmit` — Expected: PASS.
- [ ] **Step 7: Commit** `git add src && git commit -m "Limit suggestions per IP and per day"`

## Task 3: Limit POST /plans

**Covers:** AC3, AC4, AC5, AC6

**Files:**
- Modify: `src/web/routes/create.ts`
- Test: `src/web/routes/create.test.ts`

**Interfaces:**
- Consumes: the `limit(route, render429)` helper, `PUBLISH_LIMIT_NOTICE` and `clientIp` (Task 2); `stateFor` and `enteredValues` already in `create.ts`; `countPlans` from `domain/plans.ts`.

- [ ] **Step 1: Write the failing test** `answers 429 on the 4th publish from one IP (AC3)` in the `POST /plans` describe. Three valid posts with `Fly-Client-IP: 203.0.113.7` (distinct `email` each) return 303; a 4th with `venue: 'Chez Panisse'` returns 429 with a numeric `Retry-After`, the body contains `Lots of plans from here just now. Try again in a little while.`, the body keeps `Chez Panisse` and the other entered values, and `countPlans(db)` is 3.
- [ ] **Step 2: Run** `npx vitest run src/web/routes/create.test.ts -t "4th publish"` — Expected: FAIL.
- [ ] **Step 3: Implement**: register `limit('publish', …)` on `/plans` before `zValidator`. The render builds `await stateFor(deps, await enteredValues(c))` with `notice: PUBLISH_LIMIT_NOTICE` added to whichever variant it returns, status 429, same layout and title as `rerenderPublish`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Add tests one at a time, each RED then GREEN:**
  - `answers 429 on the 51st publish of a Los Angeles day (AC4)`: 50 posts from distinct IPs (distinct emails), then a 51st from a new IP → 429; `countPlans` is 50.
  - `does not limit another IP (AC5)`: IP A is limited at its 4th, IP B's first post is 303.
  - `counts invalid publishes (AC6)`: 3 posts with an empty `venue` (each 422) from one IP, then a valid one → 429 and no plan stored.
  - `keeps the suggestion card on the 429 page`: a limited post carrying a valid `suggestionId` renders the card state with the notice.
- [ ] **Step 6: Run** `npx vitest run src/web && npx tsc --noEmit` — Expected: PASS.
- [ ] **Step 7: Commit** `git add src && git commit -m "Limit publishing per IP and per day"`

## Task 4: Limited requests log at warn without the IP

**Covers:** AC7

**Files:**
- Test: `src/web/routes/create.test.ts`
- Modify: `src/web/routes/create.ts` only if the test finds a leak

**Interfaces:**
- Consumes: the `limit` helper's `log.warn('rate limited', { route })` (Task 2); the stdout-capture pattern in `src/web/request-logger.test.ts` (spying on `process.stdout.write`, a system boundary).

- [ ] **Step 1: Write the test** `logs a limited suggest request at warn without the IP (AC7)`: capture stdout, push `POST /suggest` from `Fly-Client-IP: 203.0.113.7` over the limit, parse the JSON lines, and assert exactly one line has `msg: 'rate limited'` and `level: 'warn'`, and that no captured line (the request log line included) contains `203.0.113.7`.
- [ ] **Step 2: Run** `npx vitest run src/web/routes/create.test.ts -t "without the IP"` — Expected: PASS if Task 2 logged as specified (it should have been RED in Task 2 only for the 429, so first temporarily log the IP to see this test FAIL, then remove it); fix `create.ts` if it leaks.
- [ ] **Step 3: Add** the same test for `POST /plans` (`route: 'publish'`) and run `npx vitest run && npx tsc --noEmit` — Expected: all green.
- [ ] **Step 4: Check by hand** (`src/main.ts` has no automated tests at poc): confirm that `serve({ fetch: app.fetch, port })` gives `getConnInfo` the socket by reading `node_modules/@hono/node-server/dist/conninfo.mjs` (it reads `c.env.incoming.socket`). Record the result as a `Ruling:` line below.
- [ ] **Step 5: Commit** `git add src specs/calvin-2/plans/story-131.md && git commit -m "Test that limited requests log without the IP"`

## Rulings

Ruling: every request increments both counters even when refused — the spec says every request that passes CSRF counts — a refused burst keeps the window full until it ends, the stricter reading.
Ruling: the limiter is built inside `createApp` from `deps.now`, not passed through `AppDeps` — keeps `AppDeps` unchanged for existing tests and gives each test app fresh counters — a story needing a shared limiter across apps would have to lift it into `deps`.
Ruling: the 429 renders reuse `stateFor` and the fallback state with an optional `notice` on all `CreateState` variants — the spec says the "same page" is re-rendered, and the card must survive a publish 429 — touches the view more than a fallback-only notice would.
Ruling: R9's page (`/m/:token/new`) isn't built yet, so the publish 429 covers only the R1 shape — R9 belongs to its own story — that page will need to reuse `PUBLISH_LIMIT_NOTICE`.
