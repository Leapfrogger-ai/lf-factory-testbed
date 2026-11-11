# Story 5.2 (#295): Creating a plan, first visit to empty card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell a first-time creator what calvin does (lede, placeholders, a help line) and make the rate-limited suggest response the full empty card with a "Try suggesting again" button.

**Architecture:** All copy lives in `src/web/views/create-page.ts` (a pure view). The route `renderSuggestLimited` in `src/web/routes/create.ts` already renders the `fallback` state with `SUGGEST_LIMIT_NOTICE` and status 429; only the view changes so that state shows the retry button. The `.lede` and `.help` CSS already exist in `public/app.css` (Story 5.1), so there is no CSS change.

**Tech Stack:** TypeScript on Node 26, Hono + `hono/html`, Vitest 5 (`app.request()` for routes, real Postgres from `embedded-postgres`).

**Spec:** .factory/story.md (story #295)

## Global Constraints

- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address — SQL and I/O stay in one module, and NFR006 holds by construction.
- Errors follow the architecture's Error Handling section: a field error re-renders the same page with 422 and keeps what was entered, any bad token is the same 404 page (a malformed one without a database query), a suggestion failure is a fallback card and never a 5xx, and anything unexpected goes to `app.onError` with no stack trace on the page — users never see a different error shape per route.
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Tests verify behaviour through public interfaces, at the seams `specs/calvin/test-strategy.md` names — tests that reach inside break on every refactor.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- Postgres server: the test run's own, started by `embedded-postgres` on `127.0.0.1:${FACTORY_PORT_BASE + 2}` (default 20002), user `postgres`, password `calvin`, data in the worktree's `.factory/pgdata`; Test database: `FACTORY_DB_NAME` on that server (default `calvin_test`)
- Test command `npx vitest run`, type check `npx tsc --noEmit`.

Binding: CODING_STANDARDS.md, specs/calvin-6/test-strategy.md, specs/calvin-6/epics.md

## Review Focus

- A rate-limited request with HTML-special characters in the area: still escaped on the empty card (the existing test `escapes what was entered on the 429 page` keeps passing).
- A rate-limited request whose area or time window is blank: the context line shows what was entered with no stray separator logic added; empty card still renders (Task 3 test).
- Inputs form re-rendered with a field error (422): the lede shows exactly once (Task 1 test).
- A rate-limited response must not call Claude or store a suggestion row (Task 3 test asserts `suggest.calls` and `countSuggestions` unchanged).
- The suggestion card and the "Same again" page gain neither the lede nor the help line (Tasks 1 and 2 tests).

## Task 1: Inputs form lede and placeholders

**Covers:** AC1, AC2

**Files:**
- Modify: `src/web/views/create-page.ts` (the `inputs` branch and the `input()` helper)
- Test: `src/web/views/create-page.test.ts`, `src/web/routes/create.test.ts`

**Interfaces:**
- Produces: `input(field, label, fallback, options)` accepts `options.placeholder?: string`, rendered as `placeholder="…"` only when given. Exported `LEDE = "Say roughly where and when. We'll suggest one specific plan you can share in your chat."`. Task 2 uses the `placeholder` option.

- [ ] **Step 1: Write failing tests**
  - `create-page.test.ts`, in `describe('createPage inputs state')`: `renders the lede after the h1, with the area and time placeholders`. Render `{ kind: 'inputs', values: {} }`. Assert the body contains `<p class="lede">Say roughly where and when. We&#39;ll suggest one specific plan you can share in your chat.</p>`, that its index is greater than the index of `</h1>`, that the `area` input tag contains `placeholder="e.g. Rockridge, near the BART"` and the `timeWindow` tag `placeholder="e.g. Saturday morning"`.
  - Same file: `keeps one lede when the inputs form has errors`: render with errors `{ area: 'Add a rough area.' }`; the body matches `class="lede"` exactly once.
  - Same file: `has no lede on the card, the fallback or the again page`: render `card()`, `fallback()` and the file's existing `again` state; none contains `class="lede"`.
  - `create.test.ts`, in `describe('POST /suggest')`: `has no lede on the card for the example inputs (AC2)`: `postSuggest(testDeps(), {})`, request the `location` it returns, body does not contain `class="lede"`. Also `GET /` body (first visit) contains `class="lede"` and both placeholders.
- [ ] **Step 2: Run** `npx vitest run src/web/views/create-page.test.ts src/web/routes/create.test.ts`. Expected: the lede and placeholder tests FAIL; the no-lede tests may already pass (they guard the next step).
- [ ] **Step 3: Implement** the optional `placeholder` in `input()`; export `LEDE`; in the `inputs` branch render `<p class="lede">${LEDE}</p>` directly after the `<h1>` in `main` for `state.kind === 'inputs'` only; pass the area and time placeholders from the test above.
- [ ] **Step 4: Run** the same command and `npx tsc --noEmit`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `git add src/web && git commit -m "feat: lede and placeholders on the inputs form (#295)"`.

## Task 2: Empty-card placeholders and help line

**Covers:** AC3

**Files:**
- Modify: `src/web/views/create-page.ts` (the publish form branch)
- Test: `src/web/views/create-page.test.ts`, `src/web/routes/create.test.ts`

**Interfaces:**
- Consumes: the `placeholder` option from Task 1.
- Produces: exported `DECIDE_BY_HELP = "Leave Decide by empty and we'll pick a sensible time."`.

- [ ] **Step 1: Write failing tests**
  - `create-page.test.ts`: `shows example placeholders and the decide-by help on the empty card`: render `fallback()`; the `format` input tag contains `placeholder="e.g. coffee, drinks, a walk"`, the `venue` tag `placeholder="e.g. Blue Bottle, College Ave"`; the body contains `<p class="help">Leave Decide by empty and we&#39;ll pick a sensible time.</p>`, after the `Decide by` label and before `<h2>`.
  - Same file: `keeps the card and the again page free of the help line`: neither `card()` nor the `again` render contains `Leave Decide by empty`, and neither has the `format` placeholder.
  - `create.test.ts`, next to `shows the fallback for a failed suggestion` (it.each over fixtures): add `shows placeholders, help line and notice on the fallback card (AC3)` using the `refusal` fixture, asserting both placeholders, the help text (escaped, `we&#39;ll`) and the notice `We couldn&#39;t come up with a suggestion just now. Fill in your own below, or try again.`
- [ ] **Step 2: Run** the two files. Expected: FAIL on placeholders and help line.
- [ ] **Step 3: Implement** in the publish form: pass `placeholder` to the `format` and `venue` inputs only when `state.kind === 'fallback'`; after the closing `</div>` of `.card` and before `<h2>`, render `<p class="help">${DECIDE_BY_HELP}</p>` only when `state.kind === 'fallback'`.
- [ ] **Step 4: Run** the two files and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/web && git commit -m "feat: placeholders and help line on the empty card (#295)"`.

## Task 3: Rate-limited suggest shows the empty card with Try suggesting again

**Covers:** AC4

**Files:**
- Modify: `src/web/views/create-page.ts` (`suggestAgain` and the trailing fallback block)
- Test: `src/web/routes/create.test.ts` (`describe('POST /suggest rate limit')`), `src/web/views/create-page.test.ts`

**Interfaces:**
- Consumes: the `fallback` state, `SUGGEST_LIMIT_NOTICE`, and the empty card from Task 2.
- Produces: `suggestAgain(context: Context, previousId: string | undefined, label: string)`; the hidden `previousSuggestionId` input is emitted only when `previousId` is defined. A `fallback` state always shows the "Try suggesting again" form.

- [ ] **Step 1: Write failing tests**
  - `create.test.ts`: `shows the empty card, context line and Try suggesting again when rate limited (AC4)`. Exhaust 10 suggestions for IP `203.0.113.7` as the existing 429 test does, then `postSuggest(deps, { timeWindow: 'Saturday morning' }, fromIp('203.0.113.7'), app)` (city Oakland and area Rockridge are `postSuggest`'s defaults). Assert: status 429; body contains `Oakland · Rockridge · Saturday morning`, `SUGGEST_LIMIT_NOTICE`, the labels `What`, `Where`, `Date`, `Time`, `Decide by`, `Minimum, you included` with `inputTag(body, 'minimum')` containing `value="3"`, and `Try suggesting again`; the body has two `data-suggest-form`-free checks: no `name="previousSuggestionId"` and no `We couldn&#39;t come up with a suggestion`; `deps.fakes.suggest.calls` has length 10 and `countSuggestions(db)` is 10.
  - `create-page.test.ts`: `shows Try suggesting again on a fallback without a previous suggestion`: `fallback()` contains `Try suggesting again` and no `name="previousSuggestionId"`.
- [ ] **Step 2: Run** `npx vitest run src/web/views/create-page.test.ts src/web/routes/create.test.ts`. Expected: FAIL (no button without a `previousSuggestionId`).
- [ ] **Step 3: Implement**: make `previousId` optional in `suggestAgain`, and change the trailing block to `state.kind === 'fallback' ? suggestAgain(context, state.previousSuggestionId, 'Try suggesting again') : ''`. If an existing test (for instance `shows the fallback form when a publish fails without a suggestion`) pins the button's absence, rule the smallest correction and record a `Ruling:` in this file's Rulings.
- [ ] **Step 4: Run** `npx vitest run` in full and `npx tsc --noEmit`. Expected: all PASS.
- [ ] **Step 5: Commit** `git add src/web && git commit -m "feat: rate-limited suggest shows the empty card with a retry button (#295)"`.

## Task 4: A plan published from the rate-limited empty card

**Covers:** AC5

**Files:**
- Test: `src/web/routes/create.test.ts` (no production change expected)

**Interfaces:**
- Consumes: helpers `post(deps, overrides)` and `publishedPlan(res)` in `create.test.ts`, `planForm` (date `2026-11-14`, the example date every plan test uses, with `testDeps()`'s default clock), `countSuggestions`.

- [ ] **Step 1: Write the test** `publishes the rate-limited empty card as a fallback plan (AC5)`: exhaust the suggest limit for one IP and take the 429 page (assert it contains `action="/plans"` and no `name="suggestionId"`). Then publish through `post(deps, { timeWindow: 'Saturday morning', format: 'coffee', venue: 'Blue Bottle', name: 'Ana', email: 'ana@example.test' })`. Assert: 303 to `/m/<token>/published`; the plan's `suggestionId` and `suggestionEdited` are `null`; `commitDeadlineAt` is `'2026-11-12T06:00:00Z'` (the default pinned by the first `POST /plans` test); `countSuggestions(db)` is still 10.
- [ ] **Step 2: Run** `npx vitest run src/web/routes/create.test.ts -t "rate-limited empty card"`. Expected: PASS on the first run. Show it can fail: temporarily pass an ok suggestion's id as `suggestionId` and confirm the null assertion FAILS, then revert.
- [ ] **Step 3: Run** `npx vitest run` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 4: Commit** `git add src/web && git commit -m "test: publish from the rate-limited empty card (#295)"`.

## Rulings

Ruling: the rate-limited response keeps status 429 and `Retry-After` — existing rate-limit tests pin them and the story's AC says the response "shows" the card, not a status — if the operator wants 200, it is a one-line change in `renderSuggestLimited` plus the existing tests.
Ruling: placeholders and the help line render only on `fallback` states, including a publish failure that returns the fallback form — the story says "empty card" and "the suggestion card itself is unchanged" — a publish-failure fallback gets the same harmless copy.
Ruling: the help line uses `class="help"` without frame C7's inline margin — `.help` already sets `margin-top: 4px`, and the operator's 360px hand check after the merge (story text) covers spacing and sideways scrolling — if wrong, a one-line CSS tweak.
