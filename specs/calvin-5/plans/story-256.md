# Check-in answer link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /c/:token/:question/:answer` (R12) records the creator's check-in answer and renders the thank-you page, offering the other question when it is still unanswered.

**Architecture:** One domain function in `src/domain/plans.ts` locks the plan row, requires `confirmed`, upserts the answer and appends `check_in.answered` in one transaction, and reports whether the other question is answered. A pure view `check-in-page.ts` renders the copy using the withdraw page's layout. A thin route `check-in.ts` validates params, calls the domain, and renders the view or the shared not-found page.

**Tech Stack:** TypeScript on Node 26, Hono (`hono/html`), Drizzle, Vitest with the worktree's Postgres.

**Spec:** .factory/story.md (story #256)

## Global Constraints

- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address — SQL and I/O stay in one module, and NFR006 holds by construction.
- Plan and commit state changes only in `src/domain/plans.ts`, inside a transaction that locks the plan row and appends its event through `appendEvent` — one source of truth, and commit races settle on the row lock.
- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine
- Use Hono's `app.request()` for route tests; don't add supertest or listen on a port
- Use Drizzle's `db.transaction` and `.for('update')` for commit, confirm, call-off and deadline resolution; don't add application locks
- Errors follow the architecture's Error Handling section: a field error re-renders the same page with 422 and keeps what was entered, any bad token is the same 404 page (a malformed one without a database query)
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities.
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones
- Tests verify behaviour through public interfaces, at the seams `specs/calvin/test-strategy.md` names — tests that reach inside break on every refactor.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- **Path tokens**: `:token` must match `^[A-Za-z0-9_-]{43}$`. Anything else is a 404 **without a database query** (api-specification.md)
- **One not-found for every miss.** An unknown token, a malformed token, the creator's withdraw token, or a check-in link for a plan that isn't confirmed all render the same not-found page with 404 (api-specification.md §2)
- `noindex` on every route except `GET /`; the page also carries `<meta name="robots" content="noindex">` (api-specification.md, response headers)
- Test database and ports come from the worktree's `FACTORY_PORT_BASE` / `FACTORY_DB_NAME` via `TEST_DATABASE_URL` in `vitest.config.ts`; tests use `testDb()` and `resetDb()`, never their own connection.
- `build` is `npx tsc --noEmit`; `test` is `npx vitest run`.

Binding: CODING_STANDARDS.md, GLOSSARY.md, docs/adr/0002-postgres-owns-state-temporal-owns-time.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md, specs/calvin-5/test-strategy.md, specs/calvin-5/architecture.md, specs/calvin-5/api-specification.md

## Review Focus

- `HEAD /c/...` — Hono answers it with the GET handler, so it writes too; the spec accepts this, so no test asserts otherwise.
- A creator's withdraw token or a manage/public token used in `/c/...` → same 404, nothing written (Task 3).
- Two answers to the same question in a row (`happened/yes` twice) → one stored row, two events, page still reads "it happened" (Task 1).
- A check-in link for a confirmed plan whose gathering is long past still works (no time gate in R12) (Task 1).
- Both answers given in either order: the second page never shows a question already answered (Tasks 1 and 3).

## File Structure

- Modify `src/domain/plans.ts`: add `recordCheckInAnswer`, add `checkInAnswers` to `PlanView`/`loadPlan` (so tests read answers through the domain, not SQL).
- Create `src/web/views/check-in-page.ts`: pure thank-you page.
- Create `src/web/routes/check-in.ts`: `checkInRoutes(deps)`.
- Modify `src/web/app.ts`: mount `checkInRoutes`.
- Tests: `src/domain/plans.test.ts`, `src/web/views/check-in-page.test.ts`, `src/web/routes/check-in.test.ts`.

### Task 1: Record a check-in answer

**Covers:** AC1, AC2, AC5

**Files:**
- Modify: `src/domain/plans.ts`
- Test: `src/domain/plans.test.ts`

**Interfaces:**
- Consumes: `appendEvent` (`src/domain/events.ts`), `checkInAnswers` table (`src/db/schema.ts`).
- Produces:
  - `type CheckInQuestion = 'happened' | 'attended'`
  - `type CheckInResult = { outcome: 'not_found' } | { outcome: 'recorded'; other: CheckInQuestion; otherAnswered: boolean }`
  - `recordCheckInAnswer(deps: Pick<AppDeps, 'db'>, checkInToken: string, question: CheckInQuestion, answer: boolean): Promise<CheckInResult>`
  - `PlanView.checkInAnswers: { question: CheckInQuestion; answer: boolean }[]`, ordered by question name.

Fixture (worked): `publishPlan(deps, { name: 'Ann', email: 'ann@example.test' })` makes the builder default plan (minimum 3, Blue Bottle). The creator counts as one commit, so two more commits (Mia, Raj via `commit(deps, publicToken, form(...))`) make 3 of 3 and confirm it (the deadline is 2026-11-12 and `now` is 2026-11-09T18:00:00Z, so the plan is still open when they commit). Add a local helper `confirmedPlan(deps)` in the test file that does this and returns the `publishPlan` result. The called-off case calls `callOff(deps, manageToken)` after it.

- [ ] **Step 1: Write failing test** `it('records an answer and an event, and reports the other question unanswered')`: on a confirmed plan, `recordCheckInAnswer(deps, checkInToken, 'happened', true)` returns `{ outcome: 'recorded', other: 'attended', otherAnswered: false }`; `loadPlan(...).checkInAnswers` equals `[{ question: 'happened', answer: true }]`; events filtered to `check_in.answered` equal `[{ type: 'check_in.answered', data: { question: 'happened', answer: true } }]`.
- [ ] **Step 2: Run** `npx vitest run src/domain/plans.test.ts -t "records an answer"`. Expected: FAIL (`recordCheckInAnswer` not exported, `checkInAnswers` undefined).
- [ ] **Step 3: Implement** `recordCheckInAnswer` and the `checkInAnswers` field in `src/domain/plans.ts`. In one `deps.db.transaction`: select the plan by `checkInToken` with `.for('update')`; return `not_found` unless `state === 'confirmed'`; `insert(checkInAnswers).onConflictDoUpdate` on `[planId, question]`, setting `answer` and `answeredAt` to `sql\`now()\`` (no `now` dep is passed; the column default uses the database clock too); `appendEvent` with `type: 'check_in.answered'`, `data: { question, answer }` and no `commitId`; read the other question's row for `otherAnswered`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Write failing test** `it('replaces a repeated answer and records a second event')`: `happened/yes` then `happened/no` gives `checkInAnswers` of `[{ question: 'happened', answer: false }]` and two `check_in.answered` events whose `data.answer` are `[true, false]`. If it passes first time, mutate the upsert to `onConflictDoNothing`, see it fail, restore it. Then `it('reports the other question answered once both exist')`: answer `happened/yes`, then `attended/no`; the second result is `{ outcome: 'recorded', other: 'happened', otherAnswered: true }`.
- [ ] **Step 6: Write failing test** `it.each` for the not-found cases, each returning `{ outcome: 'not_found' }` with `checkInAnswers` empty and no `check_in.answered` event: a called-off plan's check-in token (confirm, then `callOff`), an open plan's check-in token (published only, never confirmed), and an unknown well-formed token (`newToken()`, with the plan's `checkInAnswers` still read from the real plan). Run; fix until all pass.
- [ ] **Step 7: Run** `npx vitest run src/domain/plans.test.ts` and `npx tsc --noEmit`. Expected: PASS, no type errors.
- [ ] **Step 8: Commit** `git add src/domain/plans.ts src/domain/plans.test.ts && git commit -m "Record a check-in answer in one transaction"`

### Task 2: Thank-you page view

**Covers:** AC1, AC2, AC3, AC4, AC6

**Files:**
- Create: `src/web/views/check-in-page.ts`
- Test: `src/web/views/check-in-page.test.ts`

**Interfaces:**
- Consumes: `brand` (`layout.ts`), `CheckInQuestion` (Task 1).
- Produces: `checkInPage({ token, question, answer, next }: { token: string; question: CheckInQuestion; answer: boolean; next: CheckInQuestion | null }): HtmlEscapedString`. `next` is the other question when unanswered, else null.

Copy (api-specification R12): `happened` yes "Thanks! Got it: it happened."; `happened` no "Thanks! Got it: it didn't happen."; `attended` yes "Thanks! Got it: you were there."; `attended` no "Thanks! Got it: you weren't there." Follow-up headings: `happened` is "Did it happen?", `attended` is "Were you there?". Layout mirrors `withdraw-page.ts`: `<main>${brand}<h1>…</h1>…</main>`. The links are `<a class="btn btn-primary" href="/c/${token}/${next}/yes">Yes</a>` and a **No** link with class `btn` to `/c/${token}/${next}/no`; check `public/app.css` for the existing button class names and reuse them, adding no CSS. The page shows no venue, date, name or email (see Rulings).

- [ ] **Step 1: Write failing test** `it.each` over the four answer combinations with `next: null`: the decoded output contains the exact copy above and does not contain "Did it happen?", "Were you there?" or `href="/c/`.
- [ ] **Step 2: Run** `npx vitest run src/web/views/check-in-page.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `checkInPage` in `src/web/views/check-in-page.ts` with a copy map keyed by question and answer.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Write failing test** `it('offers the other question with Yes and No links')`: for `{ question: 'happened', answer: true, next: 'attended' }` the output contains "Were you there?", `href="/c/TOKEN/attended/yes"` and `href="/c/TOKEN/attended/no"` (TOKEN is a 43-char literal); for `{ question: 'attended', answer: true, next: 'happened' }` it contains "Did it happen?" and `href="/c/TOKEN/happened/yes"`. Run (FAIL), implement the follow-up block, run (PASS).
- [ ] **Step 6: Commit** `git add src/web/views/check-in-page.ts src/web/views/check-in-page.test.ts && git commit -m "Check-in thank-you page"`

### Task 3: R12 route

**Covers:** AC1, AC2, AC3, AC4, AC5, AC6

**Files:**
- Create: `src/web/routes/check-in.ts`
- Modify: `src/web/app.ts` (import and `app.route('/', checkInRoutes(deps))` after `withdrawRoutes`)
- Test: `src/web/routes/check-in.test.ts`

**Interfaces:**
- Consumes: `recordCheckInAnswer` (Task 1), `checkInPage` (Task 2), `isToken`, `layout`, `notFoundPage`.
- Produces: `checkInRoutes(deps: AppDeps): Hono` serving `GET /c/:token/:question/:answer`.

Behaviour: if `isToken(token)` is false, `question` is not `happened`/`attended`, or `answer` is not `yes`/`no`, return the not-found page with 404 and make no database call. Otherwise call `recordCheckInAnswer(deps, token, question, answer === 'yes')`. `not_found` gives the same 404 (`layout('Plan not found', notFoundPage(), { noindex: true })`, as `withdraw.ts` does). `recorded` gives `c.html(layout('Thanks', checkInPage({ token, question, answer: answer === 'yes', next: otherAnswered ? null : other }), { noindex: true }))`. `layout` without `og` yields the generic OG tags.

Test setup: same `confirmedPlan` approach as Task 1 (builder defaults, Mia and Raj committed through `commit(...)`), `createApp(deps, { baseUrl: TEST_BASE_URL })`, `app.request('/c/...')`, answers read through `loadPlan(...).checkInAnswers`. Decode entities as `withdraw.test.ts` does.

- [ ] **Step 1: Write failing test** `it('records happened/yes and offers the attended question (AC1)')`: status 200; the body contains "Thanks! Got it: it happened.", "Were you there?", `href="/c/TOKEN/attended/yes"` and `href="/c/TOKEN/attended/no"` (TOKEN is the plan's `checkInToken`); `checkInAnswers` is `[{ question: 'happened', answer: true }]`; exactly one `check_in.answered` event.
- [ ] **Step 2: Run** `npx vitest run src/web/routes/check-in.test.ts`. Expected: FAIL (404 from the catch-all).
- [ ] **Step 3: Implement** `checkInRoutes` and mount it in `src/web/app.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Write failing test** `it('replaces an earlier answer (AC2)')`: `happened/yes` then `happened/no`; the second body contains "Thanks! Got it: it didn't happen."; stored answer is `false`; two events. It should already pass: mutate the domain upsert to `onConflictDoNothing` once to see RED, then restore it.
- [ ] **Step 6: Write failing tests** `it('shows no other question once both are answered (AC3)')`: `happened/yes` then `attended/no`; the body contains "Thanks! Got it: you weren't there." and contains none of "Did it happen?", "Were you there?", `href="/c/`. And `it('offers happened after attended/yes first (AC4)')`: `attended/yes` first gives "Thanks! Got it: you were there.", "Did it happen?", and links to `/c/TOKEN/happened/yes` and `/c/TOKEN/happened/no`.
- [ ] **Step 7: Write failing test** `it.each` for AC5, each requesting its link and expecting status 404, a body equal to the body of an unknown path (`/nope`, the shared not-found page), `checkInAnswers` empty and no `check_in.answered` event: the called-off plan's check-in token (`callOff` after confirming); an unknown well-formed token; a malformed token (`short`); question `maybe`; answer `perhaps`; and the creator's withdraw token (from `loadPlan(...).commits`) used as the token.
- [ ] **Step 8: Write failing test** `it('is noindex, has generic OG tags and leaks no email or committer name (AC6)')`: for the 200 page after `happened/yes` with Mia Chen and Raj Patel committed, the body contains `<meta name="robots" content="noindex"` and `<meta property="og:title" content="Calvin"`, and does not contain `@`, `example.test`, "Mia", "Raj", "Ann" or "Blue Bottle".
- [ ] **Step 9: Run** `npx vitest run` and `npx tsc --noEmit`. Expected: all PASS, no type errors.
- [ ] **Step 10: Commit** `git add src/web/routes/check-in.ts src/web/routes/check-in.test.ts src/web/app.ts && git commit -m "R12: answer the check-in with one tap"`

## Rulings

Ruling: the thank-you page shows no venue at all — the story says "no plan details beyond the venue", which permits but doesn't require it, and R12's copy table lists none — a reviewer wanting the venue adds one line to the view.
Ruling: `recordCheckInAnswer` takes only `db` and uses the database clock for `answered_at` — the route has no use for `now`, and the column already defaults to `now()` — if tests ever need a fixed `answered_at`, add `now` to the signature.
Ruling: `PlanView` gains `checkInAnswers` so tests read answers through `domain/plans.ts` — the test strategy forbids test-owned SQL outside the Send ledger seam — it costs one extra query in `loadPlan`.
