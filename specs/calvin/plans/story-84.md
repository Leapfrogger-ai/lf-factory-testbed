# Public plan page, logger and response headers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An invitee opens `GET /p/<publicToken>` and sees the open plan (pill, venue, time, seat row, deadline line, OG tags), on a server that logs JSON lines with tokens redacted and sets the API specification's §2 headers on every response.

**Architecture:** One new read in `domain/plans.ts` feeds a pure view; a thin route in `src/web/routes/public.ts` parses the token, loads, renders. Cross-cutting middleware (request logger, security headers) is registered in `createApp`. Display formats live in `domain/time.ts`.

**Tech Stack:** Node 26 (native TS, JS `Temporal`), Hono 4 (`hono/html`, `hono/secure-headers`, `serveStatic`), Drizzle, Vitest 5 with the worktree's embedded Postgres.

**Spec:** .factory/story.md (story #84)

## Global Constraints

Quoted from the repo's binding documents; every task's requirements include them.

- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address — SQL and I/O stay in one module, and NFR006 holds by construction.
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed in.
- Times are stored as UTC `timestamptz`, and every local-time rule and display format goes through `src/domain/time.ts` with `PLAN_TIME_ZONE` — one place for DST and the UX §8.8 formats.
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Errors follow the architecture's Error Handling section: a field error re-renders the same page with 422 and keeps what was entered, any bad token is the same 404 page (a malformed one without a database query), a suggestion failure is a fallback card and never a 5xx, and anything unexpected goes to `app.onError` with no stack trace on the page — users never see a different error shape per route.
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities. ([ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Environment variables are read only in `src/config.ts` (and `DATABASE_URL` in `src/db/migrate.ts`), validated with zod at startup — one place says what the app needs.
- Use `hono/secure-headers` (with `NONCE` and `Referrer-Policy: no-referrer`) for security headers; don't set them by hand — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Hono's `app.onError`, `app.notFound` and `HTTPException` for the error and not-found pages; don't try/catch in every route — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Hono's `app.request()` for route tests; don't add supertest or listen on a port — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Node 26's JS `Temporal` (`Temporal.ZonedDateTime` in `America/Los_Angeles`) for all local-time math; don't do manual offset math or add `date-fns-tz` or `luxon` — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Node 26's native TypeScript type stripping to run `.ts`; don't add a `tsc`/esbuild build pipeline — [finding](specs/calvin/research/node-hono-drizzle.md).
- Tests verify behaviour through public interfaces, at the seams `specs/calvin/test-strategy.md` names — tests that reach inside break on every refactor.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- Every DST-sensitive rule has a test on 2026-11-01 and 2027-03-14 in `America/Los_Angeles` — that's where local-time rules break.
- No secret is read, stored, logged or committed other than as the architecture's Secrets table says (env vars from Fly secrets or a gitignored `.env`; never in `fly.toml`, the Dockerfile, the repo, a log line or a CI command line; `.env.example` holds names only) — a leaked secret can't be taken back.
- Path tokens: `:token` must match `^[A-Za-z0-9_-]{43}$`. Anything else is a 404 **without a database query**
- Public pages show each committer's **first name**: the first word of `commits.name`, at most 16 chars, HTML-escaped. Full names appear only on the manage page (R7).
- No page, URL or redirect ever contains an email address. The only exception is the creator's own email, pre-filled in R9's form.
- The request logger writes method, the path with tokens replaced by `:token`, status and duration. It never logs form bodies, query strings (they can hold `n`), emails, tokens or `Fly-Client-IP`.
- Test database and ports come from the worktree: `TEST_DATABASE_URL` is built in `vitest.config.ts` from `FACTORY_PORT_BASE + 2` and `FACTORY_DB_NAME`, never from `.env`; tests use `app.request()`, not a listening port; each integration file calls `resetDb(db)` in `beforeEach`.
- Commands: test `npx vitest run`; build `npx tsc --noEmit`.
- NFR002: the public page links one stylesheet, runs no script, loads no web font and no image other than the OG tag.

Binding: CODING_STANDARDS.md, GLOSSARY.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md, specs/calvin/test-strategy.md, specs/calvin/architecture.md, specs/calvin/api-specification.md

## Review Focus

Inputs the story implies but no acceptance criterion tests (each has its test in the owning task):

1. A committer name that is one very long word of non-ASCII or emoji characters: seat shows at most 16 characters without splitting a surrogate pair (Task 5).
2. A name with leading/inner extra whitespace or a single word: the first word shows, nothing blank (Task 5).
3. A plan with more committers than the minimum, or a venue/format containing `<script>` or `&`: everything is escaped, no empty seat or "you?" appears, and the pill never reads a negative "Needs N more" (Task 5).
4. `/p/` with a trailing slash, an empty token, or a 43-char token with a `.`: the same 404 page, no database query (Task 6).
5. Times near DST changes (2026-11-01, 2027-03-14) show the right wall-clock hour and AM/PM (Task 3); Intl's narrow no-break space before AM/PM never leaks into copy (Task 3).

---

## File structure

- Create `src/log.ts`: JSON-lines logger (`log.info/warn/error`).
- Create `src/web/request-logger.ts`: `redactPath`, `requestLogger()` middleware.
- Create `src/web/headers.ts`: `responseHeaders()` middleware (secure-headers, no-store, noindex rules).
- Modify `src/domain/time.ts`: `formatWhen`, `formatDeadline`.
- Modify `src/domain/plans.ts`: `loadPublicPlan`, `PublicPlan`; Modify `src/domain/plan-rules.ts`: `displayState`.
- Create `src/web/views/public-plan-page.ts`; modify `src/web/views/layout.ts` (OG options, noindex meta).
- Create `src/web/routes/public.ts`; modify `src/web/app.ts` to register middleware and the route, and to log through `log`.
- Create `public/og.png`; modify `public/app.css` (pill, eyebrow, seats).

## Rulings

- Ruling: the logger has levels `info`, `warn`, `error` only — the story needs no `debug` and an unused level is YAGNI — a later story adds it in one line.
- Ruling: `log.ts` stamps lines with `Temporal.Now.instant()`; the test strategy exempts the logger's transport from automated tests and the clock rule targets routes and `domain/` — if a reviewer disagrees, pass a clock into a `createLogger`.
- Ruling: the request logger replaces only the first segment after `/p/`, `/m/`, `/w/`, `/c/` (`/m/:token/published`), so the log keeps the route's shape while no token is ever logged; it never logs the query string.
- Ruling: `X-Robots-Tag: noindex`, `Cache-Control: no-store` and the other §2 headers go on every non-`/static/` response, `/healthz` included; only `GET /` omits `X-Robots-Tag`.
- Ruling: seat names are capped by code points with no ellipsis character (the UX spec's "ellipsised" is left to CSS `text-overflow`) — AC3 says "capped at 16 characters".
- Ruling: a `confirmed` plan can't exist before Story 2.1; `displayState` maps it to `on` (pill "It's on", all seats filled) and leaves "happening now"/"was on" windows and the commit form to Story 2.1.
- Ruling: `public/og.png` doesn't exist yet and R14 lists it; this story adds a plain generic 1200×630 card because `og:image` must resolve.
- Ruling: `loadPublicPlan` returns committers' full names, in commit order; the view takes the first word (test-strategy puts first-name capping at the Views seat). It never selects emails.

---

### Task 1: JSON-lines logger and request logger with redaction

**Covers:** AC11

**Files:**
- Create: `src/log.ts`, `src/web/request-logger.ts`
- Modify: `src/web/app.ts` (register `app.use('*', requestLogger())` first; `onError` uses `log.error('unexpected error', { errorName: err.name })` instead of `console.error`)
- Test: `src/web/request-logger.test.ts`

**Interfaces:**
- Produces: `log: { info(msg: string, context?: Record<string, unknown>): void; warn(...): void; error(...): void }` writing `JSON.stringify({ level, msg, time, ...context }) + '\n'` to `process.stdout`; `redactPath(path: string): string`; `requestLogger(): MiddlewareHandler` logging `info` `{ msg: 'request', requestId, method, path: redactPath(...), status, durationMs }` after the response, except for `/healthz`.

- [ ] **Step 1: Write the failing tests** in `request-logger.test.ts`, capturing lines with `vi.spyOn(process.stdout, 'write')` (stdout is a system boundary) and parsing each as JSON:
  - `redactPath` unit cases: `/p/<43 chars>` → `/p/:token`; `/m/<43>/published` → `/m/:token/published`; `/w/x` → `/w/:token`; `/c/<43>/did/yes` → `/c/:token/did/yes`; `/` and `/static/app.css` unchanged.
  - Route test via `createApp(testDeps(), …).request('/p/' + newToken() + '?n=Mia')`: exactly one `msg: 'request'` line; its `path` is `/p/:token`, `method` is `GET`, `status` is `404`, `durationMs` is a number; `JSON.stringify(allLines)` doesn't contain the token and doesn't contain `Mia`.
  - A malformed token (`/p/short`) is logged as `/p/:token` too; `GET /healthz` writes no `request` line.
- [ ] **Step 2: Run** `npx vitest run src/web/request-logger.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** `log.ts`, `request-logger.ts` (`requestId` from `crypto.randomUUID()`, duration from `performance.now()`), and wire `app.ts`.
- [ ] **Step 4: Run** the same file plus `npx vitest run src/web/app.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/log.ts src/web && git commit -m "Add JSON-lines logger and redacting request logger"`

### Task 2: Response headers on every response, noindex on not-found

**Covers:** AC10

**Files:**
- Create: `src/web/headers.ts`
- Modify: `src/web/app.ts` (register `responseHeaders()` after the request logger; `notFound`/`onError`/manage 404 pass `{ noindex: true }` to `layout`)
- Modify: `src/web/routes/manage.ts` (its 404 passes `{ noindex: true }`)
- Test: `src/web/headers.test.ts`

**Interfaces:**
- Produces: `responseHeaders(): MiddlewareHandler` — for every path not under `/static/`: `hono/secure-headers` with `referrerPolicy: 'no-referrer'` and the CSP `default-src 'self'; script-src 'self' 'nonce-<n>'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` (use `NONCE`), then `Cache-Control: no-store`, and `X-Robots-Tag: noindex` unless the request is `GET /`.
- Consumes: `layout(title, body, { noindex: true })` from the existing layout.

- [ ] **Step 1: Write the failing tests** (`app.request('/nope')` with the db-throwing deps style of `app.test.ts`):
  - 404 headers: `referrer-policy` is `no-referrer`, `cache-control` is `no-store`, `x-robots-tag` is `noindex`; the CSP split on `; ` into a set equals the six directives above after replacing the `'nonce-…'` value with a `'nonce-<n>'` placeholder (parse, don't compare order); body contains `<meta name="robots" content="noindex"`.
  - `GET /` has no `x-robots-tag` but still has `cache-control: no-store`; `GET /healthz` has `x-robots-tag: noindex`.
  - `GET /static/app.css` does NOT get `no-store` (its cache header is Task 7's).
- [ ] **Step 2: Run** `npx vitest run src/web/headers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `headers.ts` and wire `app.ts`/`manage.ts`; keep the existing `/static/*` cache middleware.
- [ ] **Step 4: Run** `npx vitest run src/web`. Expected: PASS (existing manage and app tests still pass).
- [ ] **Step 5: Commit** `git add src && git commit -m "Set spec §2 response headers on every response"`

### Task 3: Display formats for the public page

**Covers:** AC1, AC5

**Files:**
- Modify: `src/domain/time.ts`
- Test: `src/domain/time.test.ts` (create)

**Interfaces:**
- Produces: `formatWhen(instant: Temporal.Instant): string` → `Sat 14 Nov · 10:00 AM`; `formatDeadline(instant: Temporal.Instant): string` → `Wed 11 Nov, 10:00 PM` (UX §8.8: weekday short, day without leading zero, month short, 12-hour clock, no zone label, always `PLAN_TIME_ZONE`).

- [ ] **Step 1: Write the failing tests** with ISO literals: `2026-11-14T18:00:00Z` → `Sat 14 Nov · 10:00 AM`; `2026-11-12T06:00:00Z` → `Wed 11 Nov, 10:00 PM`; day without leading zero `2026-11-09T17:00:00Z` (9:00 AM PST) → `Mon 9 Nov · 9:00 AM`; DST: `2026-11-01T08:30:00Z` → `Sun 1 Nov · 1:30 AM` and `2026-11-01T09:30:00Z` → `Sun 1 Nov · 1:30 AM` (the repeated hour), `2027-03-14T09:59:00Z` → `Sun 14 Mar · 1:59 AM` and `2027-03-14T10:00:00Z` → `Sun 14 Mar · 3:00 AM`; and no output contains U+202F or U+00A0.
- [ ] **Step 2: Run** `npx vitest run src/domain/time.test.ts`. Expected: FAIL (not exported).
- [ ] **Step 3: Implement** both with `Intl.DateTimeFormat('en-US', { timeZone: PLAN_TIME_ZONE, … }).formatToParts`, assembling the parts yourself and replacing U+202F/U+00A0 with a plain space (newer ICU puts a narrow no-break space before AM/PM).
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/domain/time.ts src/domain/time.test.ts && git commit -m "Add public-page time formats"`

### Task 4: Load the public plan and derive its display state

**Covers:** AC4, AC6, AC7

**Files:**
- Modify: `src/domain/plans.ts`, `src/domain/plan-rules.ts`
- Test: `src/domain/plans.test.ts`, `src/domain/plan-rules.test.ts` (append)

**Interfaces:**
- Produces:
  - `type PublicPlan = { state: string; format: string; venue: string; city: string; gatheringAt: Temporal.Instant; commitDeadlineAt: Temporal.Instant; minimum: number; names: string[] }` (`names` = full names of active commits, ordered by `created_at`; no email field exists on the type).
  - `loadPublicPlan(db: Db, publicToken: string): Promise<PublicPlan | null>` — one Drizzle query (`plans` left join `commits` on `plan_id` and `withdrawn_at IS NULL`).
  - `displayState(plan: { state: string; commitDeadlineAt: Temporal.Instant }, now: Temporal.Instant): 'needs_more' | 'not_this_time' | 'on'` — `called_off`, or `open` with `now >= commitDeadlineAt`, is `not_this_time`; `open` before the deadline is `needs_more`; `confirmed` is `on`.
- Consumes: `publishPlan(deps, overrides)` from `tests/support/builders.ts`.

- [ ] **Step 1: Write the failing tests.** `plans.test.ts`: publish with `{ name: 'Ana Ruiz', email: 'ana@example.test' }`, then `loadPublicPlan(db, publicToken)` returns `format: 'coffee'`, `venue: 'Blue Bottle'`, `city: 'Oakland'`, `minimum: 3`, `names: ['Ana Ruiz']`, `gatheringAt.toString()` is `2026-11-14T18:00:00Z`, `commitDeadlineAt.toString()` is `2026-11-12T06:00:00Z`; `JSON.stringify(result)` doesn't contain `example.test`; an unknown `newToken()` returns `null`. `plan-rules.test.ts`: `displayState` for open one minute before `2026-11-12T06:00:00Z` → `needs_more`; at exactly the deadline → `not_this_time`; `called_off` before the deadline → `not_this_time`; `confirmed` → `on`.
- [ ] **Step 2: Run** `npx vitest run src/domain`. Expected: FAIL.
- [ ] **Step 3: Implement** both in the files above (convert `Date` to `Temporal.Instant` with `toTemporalInstant()` as `loadPlan` does).
- [ ] **Step 4: Run** `npx vitest run src/domain`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/domain && git commit -m "Load the public plan and derive its display state"`

### Task 5: Public plan page view, layout OG tags and styles

**Covers:** AC1, AC2, AC3, AC5, AC6

**Files:**
- Create: `src/web/views/public-plan-page.ts`
- Modify: `src/web/views/layout.ts` (add `og?: { title: string; description: string; image: string; siteName: string }` to `LayoutOptions`; when present with `noindex`, emit it instead of the generic OG tags), `public/app.css`
- Test: `src/web/views/public-plan-page.test.ts`, `src/web/views/layout.test.ts` (create)

**Interfaces:**
- Produces: `publicPlanPage(input: { plan: PublicPlan; state: 'needs_more' | 'not_this_time' | 'on' }): HtmlEscapedString` and `publicPlanOg(plan: PublicPlan, state, baseUrl: string): LayoutOptions['og']` in the same file.
- View rules: `<main>` holds the pill, the eyebrow (format with its first letter capitalised), the only `<h1>` (venue), `{city} · {formatWhen(gatheringAt)}`, then for `needs_more`/`on` a `<ul aria-label="{n} of {minimum} people in">` of `<li>` seats (filled dot `aria-hidden` plus first name; then `max(minimum − n, 0)` empty seats, the first containing text `you?`) and `Goes ahead with a minimum of {minimum}. Decide by {formatDeadline(commitDeadlineAt)}.`. Pills: `Needs {max(minimum − n, 0)} more`, `It's on`, `Not this time`. `not_this_time`: no list, no count, text `This one isn't going ahead. No harm done. Maybe next time.` and `<a href="/">Suggest a plan</a>`. First name: first whitespace-separated word, `Array.from(word).slice(0, 16).join('')`, escaped by `html`. OG: title `{Format} at {venue}`, description `{formatWhen} · {city}. Goes ahead if {minimum} are in.` (appending ` It's on.` for `on`; `Not this time` alone for `not_this_time`), image `${baseUrl}/static/og.png`, site name `calvin`.

- [ ] **Step 1: Write the failing tests** (hand-built `PublicPlan` objects, no database): the example plan (`names: ['Ana Ruiz']`, minimum 3, `needs_more`) renders `Needs 2 more`, `Coffee`, `<h1>Blue Bottle</h1>`, `Oakland · Sat 14 Nov · 10:00 AM`, `Ana`, not `Ruiz`, `you?` once, two empty seats, `aria-label="1 of 3 people in"`, `Goes ahead with a minimum of 3. Decide by Wed 11 Nov, 10:00 PM.`; exactly one `<h1`. Name `<b>Bartholomew-Alexander</b> Smith` renders `&lt;b&gt;Bartholomew-A` and no `<b>` anywhere; a name of 20 emoji shows exactly 16 of them; `'  Mia   Chen'` shows `Mia`; a venue `<script>x</script> & Co` and format `a&b` are escaped; 4 names with minimum 3 yields no empty seat and no `you?`. `not_this_time` renders the pill, both sentences and the link, and contains neither `<ul` nor `Ana`. `publicPlanOg` returns the AC5 title, description, image `https://calvin.test/static/og.png` and `calvin`. `layout.test.ts`: with `{ noindex: true, og }` the head has the four `og:` meta tags with those contents and `<meta name="robots" content="noindex"`, with a single `og:title`.
- [ ] **Step 2: Run** `npx vitest run src/web/views`. Expected: FAIL.
- [ ] **Step 3: Implement** the view, the OG helper and the layout option; add `.pill`, `.eyebrow`, `.seats`, `.seat`, `.dot`, `.meta` rules to `public/app.css` using the existing custom properties (UX §7.2: filled dot `--accent` 14px, empty dot outline `--border-strong`, `--accent-tint` pill background, `--on`/`--on-tint` for `on`, wrapping flex list, single column max 440px). No new files, fonts or images.
- [ ] **Step 4: Run** `npx vitest run src/web/views`. Expected: PASS. Manual (after merge, by the operator, per the story): 360px width, no horizontal scroll, WhatsApp and iMessage in-app browsers.
- [ ] **Step 5: Commit** `git add src/web/views public/app.css && git commit -m "Render the public plan page"`

### Task 6: `GET /p/:token` route

**Covers:** AC1, AC4, AC5, AC6, AC7, AC8

**Files:**
- Create: `src/web/routes/public.ts`
- Modify: `src/web/app.ts` (`app.route('/', publicRoutes(deps, config))`)
- Test: `src/web/routes/public.test.ts`

**Interfaces:**
- Consumes: `isToken`, `loadPublicPlan`, `displayState`, `publicPlanPage`, `publicPlanOg`, `layout` (Tasks 4–5), `AppConfig.baseUrl`, `deps.now()`.
- Produces: `publicRoutes(deps: AppDeps, config: AppConfig): Hono`. Handler: not `isToken` or no plan → `c.html(layout('Plan not found', notFoundPage(), { noindex: true }), 404)` (no query for a malformed token); otherwise `layout(title: '{Format} at {venue}', page, { noindex: true, og })`.

- [ ] **Step 1: Write the failing tests** (`resetDb` in `beforeEach`, publish through `publishPlan(deps, { name: 'Ana Ruiz', email: 'ana@example.test' })`, `createApp(deps, { baseUrl: TEST_BASE_URL })`):
  - AC1: 200 with the example plan; HTML (entity-decoded as `app.test.ts` does) contains the pill, `<h1>Blue Bottle</h1>`, the city/time line, `Ana`, `you?`, the aria label and the deadline sentence.
  - AC4: body doesn't contain `example.test` or `@`-addressed text (`/[\w.]+@[\w.]+/` has no match); the same with a creator named `<b>Bartholomew-Alexander</b> Smith` (AC3 end to end, no `<b>`).
  - AC5: head has `og:title` `Coffee at Blue Bottle`, the description, `og:image` `https://calvin.test/static/og.png`, `og:site_name` `calvin`, `noindex`.
  - AC6: `createApp({ ...deps, now: fixedClock('2026-11-12T06:00:00Z') }, …)` shows `Not this time`, the sentence and `href="/"`, and has no `<ul`.
  - AC7: unknown `newToken()` → 404 with the not-found copy; for `short`, a 44-char token, a 43-char token with `.`, `/p/`, and `/p/<43>/` the response is 404 using deps whose `db` is the throwing Proxy used in `manage.test.ts`.
  - AC8: exactly one `<link rel="stylesheet"` with `href="/static/app.css"` and no `<script`.
- [ ] **Step 2: Run** `npx vitest run src/web/routes/public.test.ts`. Expected: FAIL (404 for the valid token).
- [ ] **Step 3: Implement** `public.ts` and register it in `createApp`.
- [ ] **Step 4: Run** `npx vitest run src/web`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/web && git commit -m "Add GET /p/:token"`

### Task 7: Static files: cache header, og.png, unknown file

**Covers:** AC9

**Files:**
- Create: `public/og.png` (generic 1200×630, background `#FBF7F2`; generate once with a throwaway Node script using `node:zlib`, kept outside the repo, and commit only the PNG)
- Modify: `src/web/app.test.ts` (append)

- [ ] **Step 1: Write the failing tests** with the db-throwing deps of `app.test.ts`: `GET /static/app.css` → 200, `cache-control: public, max-age=86400`, `content-type` matching `text/css`; `GET /static/og.png` → 200, `content-type: image/png`, same cache header, body starts with the PNG signature bytes `89 50 4E 47`; `GET /static/nope.css` → 404 and no `cache-control: public`.
- [ ] **Step 2: Run** `npx vitest run src/web/app.test.ts`. Expected: FAIL on `og.png` only (the CSS and 404 cases already hold; keep them as the pinned AC).
- [ ] **Step 3: Add** `public/og.png`.
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc --noEmit`. Expected: all PASS, no type errors.
- [ ] **Step 5: Commit** `git add public/og.png src/web/app.test.ts && git commit -m "Serve the generic OG card"`
