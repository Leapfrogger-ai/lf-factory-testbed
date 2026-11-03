# Publish validation, CSRF and body limit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /plans` tells the creator every field error at once (422, entered values kept, nothing stored), and every POST is CSRF-checked (403) and capped at 16 KB (413).

**Architecture:** Most of R3's validation already exists in `src/web/forms.ts` (zod schema) and `src/web/routes/create.ts` (message mapping, `timingErrors`, `rerender`). This story pins each rule to its exact §3.2 message with route tests and fixes whatever a test shows to be wrong, and adds `hono/csrf` and `hono/body-limit` in `src/web/app.ts` with 403/413 system-error pages.

**Tech Stack:** Hono 4 (`hono/csrf`, `hono/body-limit`, `app.request()`), zod 4, `@hono/zod-validator`, vitest 5 with the embedded-Postgres test database.

**Spec:** .factory/story.md (story #127)

## Global Constraints

- Use `hono/csrf` for CSRF protection on every POST; don't add hidden form tokens — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `c.req.parseBody()` and `@hono/zod-validator` with an error hook for forms; don't parse bodies by hand — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Hono's `app.onError`, `app.notFound` and `HTTPException` for the error and not-found pages; don't try/catch in every route — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Hono's `app.request()` for route tests; don't add supertest or listen on a port — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine — [finding](specs/calvin/research/node-hono-drizzle.md).
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- One zod schema per form in `src/web/forms.ts`, applied with `zValidator('form', schema, hook)`.
- Minimum: integer ≥ 2. Deadline: in the future and before the gathering (FR007). City: one of `CITIES`.
- `TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database.
- | Test database | `FACTORY_DB_NAME` on that server (default `calvin_test`) |
- | test | `npx vitest run` |
- | build | `npx tsc --noEmit` |

Binding: CODING_STANDARDS.md, specs/calvin-2/architecture.md, specs/calvin-2/test-strategy.md

## Review Focus

- A POST with `Content-Type: multipart/form-data` or `text/plain` and a cross-origin `Origin`: 403 like the urlencoded one (Task 1).
- A POST with no `Origin` and no `Sec-Fetch-Site` at all (curl, old browser): 403, nothing stored (Task 1).
- A body of exactly 16 KB (16384 bytes) is accepted by the limit; 16385 is a 413 (Task 1).
- A minimum of `2.5`, `abc`, `-3` or `99999999999`: 422 with the minimum message, never a 500 (Task 3).
- A venue of exactly 120 characters is accepted; a venue of spaces only is "Add where it is." (Task 2).

---

## Tasks

TDD throughout: write one test, run it and see it fail (RED), then make it pass (GREEN). In Tasks 2–4 the app code may already satisfy a test; if a new test passes straight away, say so in the commit message and keep it as the pin. Where it fails, the fix is in `src/web/forms.ts` or `src/web/routes/create.ts` (keep the `MISSING` message map and `schemaErrors` there).

### Task 1: CSRF check and 16 KB body limit with 403/413 system-error pages

**Covers:** AC13, AC14

**Files:**
- Modify: `src/web/app.ts` (middleware order: after `responseHeaders()`, before routes; extend `app.onError`)
- Modify: `tests/support/builders.ts` (export `sameOrigin`), `src/web/routes/create.test.ts` (existing `post` helper sends it)
- Test: `src/web/app.test.ts` (new `describe('POST protection')`)

**Interfaces:**
- Consumes: `createApp(deps, { baseUrl })`, `systemErrorPage()`, `layout(title, body, { noindex: true })`, `log.warn`.
- Produces: `sameOrigin: { 'Sec-Fetch-Site': 'same-origin' }` in `tests/support/builders.ts`, which every later POST test spreads into its headers; every POST that fails CSRF answers 403 and any POST over 16 KB answers 413, both with the system-error page (`noindex`).

- [ ] **Step 1: Write the failing tests** in `src/web/app.test.ts`, posting to `/plans` through `createApp(testDeps(), { baseUrl: TEST_BASE_URL })`:
  - `rejects a POST from another origin with the 403 system-error page`: headers `{ Origin: 'https://evil.test', 'Sec-Fetch-Site': 'cross-site' }`, urlencoded `planForm()`; expect status 403, body contains `Something went wrong. Go back and try again.`, `countPlans(db)` is 0, `startCalls` is empty.
  - `rejects a POST with neither Origin nor Sec-Fetch-Site` (same expectations).
  - `accepts Origin equal to BASE_URL` (`Origin: TEST_BASE_URL`, no Sec-Fetch-Site) and `accepts Sec-Fetch-Site same-origin` (no Origin): status 303.
  - `rejects a cross-origin multipart POST` with a `FormData` body: 403.
  - `answers 413 with the system-error page for a body over 16 KB`: same-origin headers, `area` of 16 385 `a`s; status 413, page copy present, nothing stored.
  - `accepts a body of exactly 16 KB`: pad an unused field so the urlencoded body is exactly 16 384 bytes; the response is not 413 (it is a 303 or 422).
- [ ] **Step 2: Run** `npx vitest run src/web/app.test.ts` — Expected: the 403/413 tests FAIL (current responses are 303/500).
- [ ] **Step 3: Implement** in `createApp`: `app.use('*', csrf({ origin: config.baseUrl }))` then `app.use('*', bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.html(layout('Something went wrong', systemErrorPage(), { noindex: true }), 413) }))`, each applied to POST only (`app.post('*', …)` or a method check). In `app.onError`, when `err instanceof HTTPException` with status 403, log `warn('csrf rejected')` and return the same system-error page with 403 (also `warn` on 413 in the body-limit handler); everything else stays the 500 `error` path. Confirm in the installed `hono/csrf` that a request passes on either `Origin` equal to `origin` or `Sec-Fetch-Site: same-origin`; if not, supply a function for `origin`/`secFetchSite` options to get that rule.
- [ ] **Step 4: Update `post` in `src/web/routes/create.test.ts`** (and any other existing POST helper) to send `sameOrigin`; add `sameOrigin` to `tests/support/builders.ts`.
- [ ] **Step 5: Run** `npx vitest run` — Expected: all PASS.
- [ ] **Step 6: Commit** `git add src tests && git commit -m "Web: CSRF check and 16 KB body limit on every POST (#127)"`

### Task 2: Required text fields and city (the first three criteria and the name/email pair)

**Covers:** AC1, AC2, AC3, AC4, AC12

**Files:**
- Modify (only if a test fails): `src/web/forms.ts`, `src/web/routes/create.ts`
- Test: `src/web/routes/create.test.ts` (`describe('POST /plans validation')`, reusing `rejected(overrides, message)`; extend it to accept several messages)

**Interfaces:**
- Consumes: `post(deps, overrides)` and `planForm()`; messages from api-specification §3.2.
- Produces: nothing new.

- [ ] **Step 1: Write failing tests**, one at a time, each asserting 422, every listed message in the body, that the other entered values (`Blue Bottle`, `coffee`, `Ann`) are still in the body, and `countPlans` is 0:
  - `no city, empty area, empty rough time` (`city: ''`, `area: ''`, `timeWindow: ''`): `Pick a city.`, `Add a rough area.`, `Add a rough time.`, each inside its own `id="city-error"`, `id="area-error"`, `id="timeWindow-error"` element.
  - `city that is not in CITIES` (`city: 'Gotham'`): `Pick a city.`
  - `empty format and empty venue`: `Say what it is, like coffee or a walk.` and `Add where it is.`
  - `venue of 121 characters`: `Keep it under 120 characters.`; and a venue of exactly 120 characters publishes (303).
  - `venue of only spaces`: `Add where it is.`
  - `empty name and email "ana@"`: `Add your name.` and `That email doesn't look right.` (HTML-escaped as `doesn&#39;t`).
- [ ] **Step 2: Run** `npx vitest run src/web/routes/create.test.ts` — Expected: new tests either FAIL on a wrong or missing message (then fix in Step 3) or pass because the behaviour exists.
- [ ] **Step 3: Fix** whatever failed so each message is exactly the §3.2 text, the first error per field wins, and entered values are kept.
- [ ] **Step 4: Run** `npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `git add src tests && git commit -m "Web: pin R3 field-error messages for required fields (#127)"`

### Task 3: Date, time and minimum rules

**Covers:** AC5, AC6, AC7, AC8

**Files:**
- Modify (only if a test fails): `src/web/forms.ts`, `src/web/routes/create.ts`
- Test: `src/web/routes/create.test.ts`

**Interfaces:**
- Consumes: `post`, `planForm`, `fixedClock` (`testDeps` clock is `2026-11-09T18:00:00Z`).
- Produces: nothing new.

- [ ] **Step 1: Write failing tests**, 422 + message + values kept + nothing stored unless noted:
  - `missing date` (`date: ''`) and `malformed date` (`date: '2026-13-45'`, `'tomorrow'`): `Pick a date.`
  - `missing time` and `malformed time` (`time: '25:00'`, `'10am'`): `Pick a time.`
  - `gathering in the past` (`date: '2026-11-01'`): `The gathering needs to be in the future.`; and a gathering exactly at `now` (`date: '2026-11-09'`, `time: '10:00'`, the clock is 10:00 PST) is also rejected.
  - `minimum of 1`: `The minimum is at least 2 people, you included.`; same for `'2.5'`, `'abc'`, `'-3'`, `''`, and `'99999999999'` (over a Postgres integer) — none is a 500.
  - `minimum of 40 is published`: status 303 and `loadPlan` shows `minimum` 40.
- [ ] **Step 2: Run** `npx vitest run src/web/routes/create.test.ts` — Expected: FAIL where the behaviour is missing, otherwise PASS.
- [ ] **Step 3: Fix** whatever failed in `src/web/forms.ts` / `create.ts`; `minimum` never shows a "Keep it under" message.
- [ ] **Step 4: Run** `npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `git add src tests && git commit -m "Web: pin R3 date, time and minimum errors (#127)"`

### Task 4: Decide-by rules

**Covers:** AC9, AC10, AC11

**Files:**
- Modify (only if a test fails): `src/web/routes/create.ts` (`timingErrors`), `src/web/forms.ts`
- Test: `src/web/routes/create.test.ts`

**Interfaces:**
- Consumes: `post`, `planForm`; the error must sit under the **Decide by** field, i.e. in the element `id="deadlineDate-error"`.
- Produces: nothing new.

- [ ] **Step 1: Write failing tests** (422, message, values kept, nothing stored):
  - `only deadlineDate given` and `only deadlineTime given`: `Pick both a date and a time, or leave both empty.`
  - `decide-by in the past` (`deadlineDate: '2026-11-01'`, `deadlineTime: '09:00'`): `The decide-by time needs to be in the future.` inside `id="deadlineDate-error"`.
  - `decide-by after the gathering` (`2026-11-14` `18:00`) and `decide-by exactly at the gathering` (`2026-11-14` `10:00`): `The decide-by time needs to be before the gathering.` inside `id="deadlineDate-error"`.
  - `decide-by errors together with a field error` (`venue: ''` plus a past deadline): both messages shown.
- [ ] **Step 2: Run** `npx vitest run src/web/routes/create.test.ts` — Expected: FAIL where missing (the "exactly at" case and the error element id are the likely gaps), otherwise PASS.
- [ ] **Step 3: Fix** whatever failed so the decide-by errors render under Decide by.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit` — Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `git add src tests && git commit -m "Web: pin R3 decide-by errors (#127)"`

## Rulings

Ruling: Tasks 2–4 are mostly characterization tests because the validation code already exists on `main` — TDD still applies, a test that is green on first run is committed as a pin and noted in its commit message — if wrong, a task has no RED step but no behaviour is lost.
Ruling: CSRF and body limit are applied to POST only and app-wide, not just to `/plans` — the story says "every POST from here on" — if wrong, a later GET route would be unaffected anyway.
Ruling: the rate-limit 429 path in R3 is out of scope — no acceptance criterion mentions it — if wrong, a later story adds `src/web/rate-limit.ts`.
