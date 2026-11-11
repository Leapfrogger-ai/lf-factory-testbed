# Check-in plan context and Yes/No buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every check-in thank-you page names the plan (format and venue, date and time), shows side-by-side Yes/No buttons for the other question, and ends with a "last tap counts" line plus a quiet "Suggest another plan" link once both are answered.

**Architecture:** `recordCheckInAnswer` already runs in one transaction on the locked plan row; it also returns the plan's `format`, `venue` and `gatheringAt` so the route needs no second query. `checkInPage` (a pure view) renders the `.context` block, `.answers` row and finished-state footer. `public/app.css` already has `.context` and `.answers` rules; a test pins them.

**Tech Stack:** TypeScript (Node 26), Hono + `hono/html`, Drizzle, Vitest 5 with `app.request()` and embedded Postgres.

**Spec:** .factory/story.md (story #299)

## Global Constraints

- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address — SQL and I/O stay in one module, and NFR006 holds by construction.
- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine
- Times are stored as UTC `timestamptz`, and every local-time rule and display format goes through `src/domain/time.ts` with `PLAN_TIME_ZONE` — one place for DST and the UX §8.8 formats.
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Errors follow the architecture's Error Handling section: a field error re-renders the same page with 422 and keeps what was entered, any bad token is the same 404 page (a malformed one without a database query), a suggestion failure is a fallback card and never a 5xx, and anything unexpected goes to `app.onError` with no stack trace on the page — users never see a different error shape per route.
- Tests verify behaviour through public interfaces, at the seams `specs/calvin/test-strategy.md` names — tests that reach inside break on every refactor.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed in.
- Tests (poc maturity): TDD for every task: a failing test (RED), then the code that passes it (GREEN). Each test's database is its own: `vitest.config.ts` builds `TEST_DATABASE_URL` from `FACTORY_PORT_BASE` (Postgres on `FACTORY_PORT_BASE + 2`) and `FACTORY_DB_NAME`; never hard-code a port or database name.

Binding: CODING_STANDARDS.md, GLOSSARY.md, specs/calvin-6/test-strategy.md

## Review Focus

- A venue containing HTML (`<b>x</b>`) must render escaped in `.kind` (covered by `hono/html`; pinned in Task 2).
- Re-tapping an answer after both are answered keeps the finished page with no Yes/No links (Task 3 route test: `attended/no` after `happened/yes`, then `happened/no`).
- A plan whose gathering falls across a DST change shows the Pacific time, not UTC (Task 3 test pins 2026-11-14 18:00Z → "10:00 AM", PST).
- Unknown/called-off tokens still return the shared 404 with no plan block (existing AC5 tests stay green).
- The finished page contains no `btn-primary`/`btn-secondary` answer buttons at all, only the quiet link (Task 2).

## Rulings

Ruling: The plan block's data rides on `recordCheckInAnswer`'s `recorded` result (`plan: { format, venue, gatheringAt }`) rather than a second `loadPublicPlan` call — the transaction already holds the plan row, and it keeps the route to parse → domain → view — if wrong, a second query is a small swap inside the route.
Ruling: The existing AC6 test lists `'Blue Bottle'` as a leak; the venue is now shown by design, so that literal is removed from the list (it is a venue, not a committer's name; `@`, `example.test`, `Mia`, `Raj`, `Ann` stay).
Ruling: `public/app.css` already declares `.context`, `.context .when`, `.context .kind`, `.answers { display:flex; gap:12px }`, `.answers .btn { flex:1 }` and `.btn` has `min-height: 48px`; Task 4 only pins them, so that test passes on first run and is shown to fail by mutation.
Ruling: Fixture is `confirmedPlan()` in `check-in.test.ts` (Ann + Mia + Raj, 3 of minimum 3, which confirms the plan; `planForm` has format `coffee`, venue `Blue Bottle`, date `2026-11-14`, time `10:00`), so the plan block is "Coffee at Blue Bottle" and "Sat 14 Nov · 10:00 AM".

---

### Task 1: `recordCheckInAnswer` returns the plan's display data

**Covers:** AC1, AC3

**Files:**
- Modify: `src/domain/plans.ts` (`CheckInResult` ~line 504, `recordCheckInAnswer` ~line 509)
- Test: `src/domain/plans.test.ts`

**Interfaces:**
- Consumes: the existing `plan` row inside the transaction (`plan.format`, `plan.venue`, `plan.gatheringAt: Date`).
- Produces: `CheckInResult` recorded variant becomes `{ outcome: 'recorded'; other: CheckInQuestion; otherAnswered: boolean; plan: { format: string; venue: string; gatheringAt: Temporal.Instant } }`.

- [ ] **Step 1: Write the failing test** in `src/domain/plans.test.ts`, next to the existing `recordCheckInAnswer` tests (reuse their confirmed-plan setup): `it('returns the plan format, venue and gathering instant with a recorded answer')` asserting `result.outcome === 'recorded'` and `result.plan` equals `{ format: 'coffee', venue: 'Blue Bottle', gatheringAt: Temporal.Instant.from('2026-11-14T18:00:00Z') }` (10:00 PST is 18:00Z; compare with `.toString()` of the instant to avoid object-equality quirks).
- [ ] **Step 2: Run** `npx vitest run src/domain/plans.test.ts -t "returns the plan format"` — Expected: FAIL (`plan` is undefined).
- [ ] **Step 3: Implement** the extra `plan` field in the `recorded` return, using `plan.gatheringAt.toTemporalInstant()` as `toPublicPlan` does.
- [ ] **Step 4: Run** the same command plus `npx tsc --noEmit` — Expected: test PASS; tsc reports an error only in `check-in.ts` if the type is used there (none yet), otherwise clean.
- [ ] **Step 5: Commit**

```bash
git add src/domain/plans.ts src/domain/plans.test.ts
git commit -m "feat: check-in result carries the plan's display data"
```

### Task 2: `checkInPage` renders the plan block, answer buttons and finished footer

**Covers:** AC1, AC2, AC3

**Files:**
- Modify: `src/web/views/check-in-page.ts`
- Test: `src/web/views/check-in-page.test.ts`

**Interfaces:**
- Consumes: `capitalise` from `./public-plan-page.ts`; `formatWhen` from `../../domain/time.ts`.
- Produces: `checkInPage({ token, question, answer, next, plan }: { …existing; plan: { format: string; venue: string; gatheringAt: Temporal.Instant } }): HtmlEscapedString`.

Markup (decided here): `<main>` = `brand`, then `<div class="context"><p class="kind">Coffee at Blue Bottle</p><p class="when">Sat 14 Nov · 10:00 AM</p></div>`, then `<h1>` thanks copy (unchanged). If `next`: `<h2>` heading, then `<div class="answers"><a class="btn btn-primary" href="/c/${token}/${next}/yes">Yes</a><a class="btn btn-secondary" href="/c/${token}/${next}/no">No</a></div>`. If `next` is null: `<p class="meta">Tapped the wrong one? Use the links in the email again; the last tap counts.</p>` then `<a class="quiet" href="/">Suggest another plan</a>`.

- [ ] **Step 1: Update the view test's `render` helper** to pass `plan: { format: 'coffee', venue: 'Blue Bottle', gatheringAt: Temporal.Instant.from('2026-11-14T18:00:00Z') }` and add failing tests (one at a time, RED each): (a) `it('opens with the plan block before the heading')` — output contains `<p class="kind">Coffee at Blue Bottle</p>`, `<p class="when">Sat 14 Nov · 10:00 AM</p>`, and `indexOf('class="context"') < indexOf('<h1>')`; (b) `it('escapes the venue')` with venue `<b>x</b>` → output contains `&lt;b&gt;x&lt;/b&gt;` and not `<b>x</b>`; (c) `it('puts Yes primary and No secondary inside .answers')` — regex `/class="answers">\s*<a class="btn btn-primary" href="\/c\/TOKEN\/attended\/yes">Yes<\/a>\s*<a class="btn btn-secondary" href="\/c\/TOKEN\/attended\/no">No<\/a>/`; (d) `it('still asks "Were you there?" after "it didn\'t happen"')` — `render('happened', false, 'attended')` contains `Thanks! Got it: it didn't happen.`, `Were you there?` and both links; (e) `it('finished page has the wrong-tap line, a quiet Suggest another plan link and no answer links')` — `render('attended', true, null)` contains the `.meta` line verbatim, `<a class="quiet" href="/">Suggest another plan</a>`, and not `btn-primary`, `btn-secondary`, `href="/c/`. Update the existing `it.each` copy test: it keeps `not.toContain('href="/c/')` (still true).
- [ ] **Step 2: Run** `npx vitest run src/web/views/check-in-page.test.ts` — Expected: FAIL on the new tests (no `plan` rendering).
- [ ] **Step 3: Implement** `checkInPage` with the markup above, building the kind line as `${capitalise(plan.format)} at ${plan.venue}` and the time with `formatWhen(plan.gatheringAt)`.
- [ ] **Step 4: Run** the same command and `npx tsc --noEmit` — Expected: PASS (tsc errors in `check-in.ts` are fixed in Task 3, so run tsc after Task 3).
- [ ] **Step 5: Commit**

```bash
git add src/web/views/check-in-page.ts src/web/views/check-in-page.test.ts
git commit -m "feat: check-in page shows the plan and side-by-side answers"
```

### Task 3: Route passes the plan to the view; page-level assertions

**Covers:** AC1, AC2, AC3, AC4

**Files:**
- Modify: `src/web/routes/check-in.ts`
- Test: `src/web/routes/check-in.test.ts`

**Interfaces:**
- Consumes: `result.plan` from Task 1; `checkInPage({ …, plan })` from Task 2.
- Produces: the same GET routes, now rendering the full pages.

- [ ] **Step 1: Write failing tests** in `check-in.test.ts` (use `confirmedPlan()` and `decodeEntities`): (a) extend the AC1 test with `body` contains `Coffee at Blue Bottle` and `Sat 14 Nov · 10:00 AM`, both before `Thanks! Got it: it happened.` (index order), a `class="answers"` block, `class="btn btn-primary" href="/c/${token}/attended/yes"` and `class="btn btn-secondary" href="/c/${token}/attended/no"`; (b) `it('after happened/no still asks Were you there?')` — GET `happened/no` → `Thanks! Got it: it didn't happen.`, `Were you there?`, both links; (c) change the AC3 test: after `happened/yes` then `attended/yes`, the body contains the plan block, `Thanks! Got it: you were there.`, `Tapped the wrong one? Use the links in the email again; the last tap counts.`, `<a class="quiet" href="/">Suggest another plan</a>`, and `not.toContain('href="/c/')`, `not.toContain('btn-primary')`; (d) re-answer: then GET `happened/no` → still the finished page (no `href="/c/`); (e) in the AC6 test, remove `'Blue Bottle'` from the leak list and add `expect(body).toContain('Coffee at Blue Bottle')`.
- [ ] **Step 2: Run** `npx vitest run src/web/routes/check-in.test.ts` — Expected: FAIL (route does not pass `plan`; tsc/runtime error).
- [ ] **Step 3: Implement** in `check-in.ts`: pass `plan: result.plan` to `checkInPage`.
- [ ] **Step 4: Run** `npx vitest run src/web/routes/check-in.test.ts src/web/views/check-in-page.test.ts src/domain/plans.test.ts` and `npx tsc --noEmit` — Expected: all PASS, tsc clean.
- [ ] **Step 5: Commit**

```bash
git add src/web/routes/check-in.ts src/web/routes/check-in.test.ts
git commit -m "feat: check-in route renders the plan block"
```

### Task 4: Pin the `.answers` CSS

**Covers:** AC5

**Files:**
- Test: `src/web/app-css.test.ts`
- Modify (only if a pin fails): `public/app.css`

**Interfaces:**
- Consumes: the file's existing `rule(selector)` helper (the one used near line 100) — if it is local to another `it`, hoist it to the `describe` scope.
- Produces: nothing.

- [ ] **Step 1: Write the test** `it('lays the Yes and No buttons side by side, at least 48px tall')`: `rule('.answers')` matches `/display:\s*flex/` and `/gap:\s*\d+px/`; `rule('.answers .btn')` matches `/flex:\s*1\b/`; `rule('.btn')` matches `/min-height:\s*48px/`.
- [ ] **Step 2: Run** `npx vitest run src/web/app-css.test.ts` — Expected: PASS on first run (the CSS already exists). Record a mutation: change `.answers .btn { flex: 1; }` to `flex: none` in `public/app.css`, re-run, Expected FAIL, then revert and re-run to PASS. If any pin fails for real, fix `public/app.css` minimally.
- [ ] **Step 3: Commit**

```bash
git add src/web/app-css.test.ts public/app.css
git commit -m "test: pin the side-by-side answer buttons"
```

### Final check

- [ ] Run `npx tsc --noEmit` and `npx vitest run` — Expected: clean and all PASS. The 360px phone check against frames K1–K3 is the operator's after merge and is not part of this build.
