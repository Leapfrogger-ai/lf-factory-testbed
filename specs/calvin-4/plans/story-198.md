# The manage page (R7): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /m/:token` renders the creator's manage page (frames M1, M2, M3, M5): state pill, plan, count, full-name list with initial tokens, public link with Copy, and the actions.

**Architecture:** A new domain read `loadManagePlan` returns the plan plus full names (the one place full names leave the database). A pure view `managePage` renders the frames with the classes Story 3.7 already put in `public/app.css` (`.private`, `.count`, `.names*`, `.linkbox`, `.stack`, `.calloff`, `.confirm`, `.btn-dim`). The route in `src/web/routes/manage.ts` validates the token with `isToken`, loads, and renders. The call-off POST is Story 3.5 and is not built here: the form only names its action.

**Tech Stack:** Hono `html` templates, Drizzle on Postgres, Vitest 5, Node 26 native TypeScript.

**Spec:** .factory/story.md (story #198)

## Global Constraints

- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine — [finding](specs/calvin/research/node-hono-drizzle.md).
- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address — SQL and I/O stay in one module, and NFR006 holds by construction.
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Tests verify behaviour through public interfaces, at the seams `specs/calvin/test-strategy.md` names — tests that reach inside break on every refactor.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- No secret is read, stored, logged or committed other than as the architecture's Secrets table says (env vars from Fly secrets or a gitignored `.env`; never in `fly.toml`, the Dockerfile, the repo, a log line or a CI command line; `.env.example` holds names only) — a leaked secret can't be taken back.
- No code outside `src/main.ts` calls `Date.now()` or `new Date()` for the current time (guardrail `tests/guardrails-source.test.ts`: no `console.*` outside `src/log.ts`, `src/main.ts` and `src/db/migrate.ts`; no `vi.mock`).
- Public pages show each committer's **first name**: the first word of `commits.name`, at most 16 chars, HTML-escaped. Full names appear only on the manage page (R7). (api-specification.md)
- The request logger writes the path with tokens replaced by `:token` and never logs query strings, emails, tokens or `Fly-Client-IP`. (api-specification.md)
- Pages are plain HTML forms that work without JavaScript. (architecture.md)
- One hand-written CSS file with tokens (UX §3–4); < 10 KB. (architecture.md)
- `TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database. (test-strategy.md; this worktree's ports and database come from `FACTORY_PORT_BASE` and `FACTORY_DB_NAME`, so run tests as `npx vitest run` and never hard-code a port or database name.)
- Commands: test is `npx vitest run`; build is `npx tsc --noEmit`. (test-strategy.md)

Binding: CODING_STANDARDS.md, GLOSSARY.md, specs/calvin-4/test-strategy.md, specs/calvin-4/architecture.md, specs/calvin-4/api-specification.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md

## Review Focus

- A committer's email must never reach the HTML, including when a name contains markup (`<b>x</b>`): names are escaped and emails never selected. Pinned in Tasks 1 and 2.
- A long or emoji name: the full name is shown (no 16-char cap) while the token is one whole code point. Pinned in Task 2.
- A withdrawn committer must not appear in the list or the count. Pinned in Task 1.
- A confirmed plan over its minimum (4 in, minimum 3) shows `4 of 3` and no empty seat. Pinned in Task 2.
- An open plan past its deadline is shown as called off (`not_this_time`), with no Call it off. Pinned in Task 3.

## Rulings

Ruling: The manage page loads `public/create.js` under the response nonce, as the published page does — its `#public-link`, `#copy` and `#copy-status` ids are what make **Copy** work, and without it Copy does nothing — if wrong, Copy is dead on this page until a later story adds the script.
Ruling: The pill's "· decide by …" suffix is added only for `needs_more` (api-specification R7: "The open pill appends…") — AC1 pins the open case and no frame shows it on other states — if wrong, one condition changes.
Ruling: `happening_now` and `was_on` get the public page's pill text and classes (`state-now`, `state-off`), the "Call it off" control is hidden in both (AC5: gathering started), and `names-on` goes on for `on` and `happening_now` — M4 draws it that way — if wrong, a class swap.
Ruling: The `?notice=too-late` notice (R7, set by Story 3.5's R8) is rendered here, since this story owns R7's page and M4 draws it; the route reads only that one value — if wrong, 3.5 adds it in a one-line view change.
Ruling: The empty decorative seat (`<li class="seat-empty" aria-hidden="true">`) is shown for `needs_more` only, once, as in M1; none on `on` or called-off pages (AC4 forbids empty seats there) — if wrong, one condition.
Ruling: `loadManagePlan` returns a new `ManagePlan` type (the `PublicPlan` fields plus `publicToken` and `manageToken`, with `names` as full names) instead of widening `PlanView`, whose commit rows carry withdraw tokens the page must not render — if wrong, the types are merged later with no behaviour change.
Ruling: The link box is left off the called-off page, as frame M5 draws it — AC4 says nothing about it — if wrong, one condition.

---

### Task 1: `loadManagePlan`

**Covers:** AC1, AC6

**Files:**
- Modify: `src/domain/plans.ts`, `src/domain/plans.test.ts`

**Interfaces:**
- Produces: `export type ManagePlan = PublicPlan & { publicToken: string; manageToken: string }` (here `names` holds full `commits.name` values, oldest commit first, active commits only) and `export async function loadManagePlan(db: Db, manageToken: string): Promise<ManagePlan | null>`, which is `null` when no plan has that manage token. It never selects `commits.email`.

- [ ] **Step 1: Write the failing tests** in `plans.test.ts` (`describe('loadManagePlan')`), publishing through `publishPlan`/`commit` as the file's other cases do:
  - `returns full names of active commits in commit order`: creator "Ana Ruiz" then "Mia Chen" commit; expect `names` toEqual `['Ana Ruiz', 'Mia Chen']`, `minimum` 3, `publicToken` and `manageToken` equal to the published ones, `venue` 'Blue Bottle'.
  - `leaves out a withdrawn commit`: Mia withdraws via `withdraw`; `names` is `['Ana Ruiz']`.
  - `is null for an unknown token`: `loadManagePlan(db, newToken())` resolves `null`.
  - `has no email on the result`: `JSON.stringify(result)` contains neither committer's email.
- [ ] **Step 2: Run to verify RED:** `npx vitest run src/domain/plans.test.ts -t loadManagePlan`. Expected: FAIL, `loadManagePlan` is not exported.
- [ ] **Step 3: Implement** in `plans.ts` next to `loadPublicPlan`: the same left-join query keyed on `plans.manageToken`, also selecting `plans.publicToken` and `plans.manageToken`. Extract the row-to-`PublicPlan` mapping into a small shared helper rather than copying it; `loadPublicPlan`'s behaviour is unchanged.
- [ ] **Step 4: Run to verify GREEN:** `npx vitest run src/domain/plans.test.ts`
- [ ] **Step 5: Commit:** `git add src/domain && git commit -m "Load a plan by its manage token with full names"`

### Task 2: The `managePage` view

**Covers:** AC1, AC2, AC3, AC4, AC5, AC6

**Files:**
- Create: `src/web/views/manage-page.ts`, `src/web/views/manage-page.test.ts`
- Modify: `src/web/views/public-plan-page.ts` (export `initial`, `pillText`, `pillClass` for reuse)

**Interfaces:**
- Consumes: `ManagePlan` (Task 1); `brand` from `layout.ts`; `capitalise`, `initial`, `pillText`, `pillClass` from `public-plan-page.ts`; `DisplayState` from `plan-rules.ts`; `formatWhen`, `formatDeadline` from `time.ts`. `pillText` already takes `(plan: PublicPlan, state: DisplayState)`.
- Produces: `export function managePage(input: { plan: ManagePlan; state: DisplayState; publicLink: string; now: Temporal.Instant; notice?: 'too-late' }): HtmlEscapedString`, the `<main>` body only (the route wraps it in `layout`).

- [ ] **Step 1: Write the failing tests** in `manage-page.test.ts`, rendering the view directly with a `plan()` helper (Ana Ruiz and Mia Chen, minimum 3, Blue Bottle, Coffee, Oakland, gathering `2026-11-14T18:00:00Z`, deadline `2026-11-12T06:00:00Z`, which read Sat 14 Nov 10:00 AM and Wed 11 Nov 10:00 PM; tokens `PUB` and `MAN`). One test, then its code:
  - AC1 `shows M1 in order`: for `state: 'needs_more'` the indexes of these strings are strictly increasing: `<p class="private">Your plan. Only you can see this page.</p>`, `<p class="brand">calvin</p>`, `<p class="pill state-open">Needs 1 more · decide by Wed 11 Nov, 10:00 PM</p>`, `<h1 class="venue">Blue Bottle</h1>`, `2 of 3`, `<ul class="names" aria-label="Who's in">`, `<span class="token" aria-hidden="true">A</span>`, `Ana Ruiz`, `<span class="token" aria-hidden="true">M</span>`, `Mia Chen`, `class="linkbox"` (containing `value="https://calvin.test/p/PUB"` and a button with text `Copy`), `href="/m/MAN/new"` (text `Start a new plan from this`, class `btn btn-secondary`), `<summary class="quiet">Call it off</summary>`.
  - AC2 `opens to the confirm`: contains `Call it off? Everyone who's in gets a short "not this time" email.` (quotes as the template escapes them), `<a class="quiet" href="/m/MAN">Keep it</a>`, and `<form method="post" action="/m/MAN/call-off">` holding a `<button` with `btn btn-dim` and text `Call it off`, and no `<input` inside the form.
  - AC3 `confirmed is M3`: `state: 'on'` gives `<p class="pill state-on">It's on</p>` and `class="names names-on"`, still with Call it off and the secondary Start-a-new-plan link.
  - AC4 `called off is M5`: `state: 'not_this_time'` gives `<p class="pill state-off">Not this time</p>`, `class="names names-off" aria-label="Who was in"`, `venue venue-off`; no `class="count"`, no `seat-empty`, no `Call it off`, and `<a class="btn btn-primary" href="/m/MAN/new">Start a new plan from this</a>`.
  - AC5 `started has no call-off`: `state: 'happening_now'` and `state: 'was_on'` each contain no `Call it off` and no `<details`. Also `state: 'on'` with `now` at or after `gatheringAt` (an ISO literal) has none.
  - AC6 `no email, and names are escaped`: a name `<b>x</b>` renders as `&lt;b&gt;x&lt;/b&gt;`, never `<b>x</b>`; the output contains no `@`.
  - Review Focus: a name of `'😀'.repeat(20)` shows in full with a token of exactly `😀`; a `confirmed` plan with 4 names and minimum 3 shows `4 of 3` and no `seat-empty`; `notice: 'too-late'` shows `<p class="notice" role="status">It's already started, so it can't be called off.</p>` after the brand and before the pill, and without `notice` there is no `role="status"`.
- [ ] **Step 2: Run to verify RED** after each test: `npx vitest run src/web/views/manage-page.test.ts`. Expected: FAIL, module not found, then one assertion at a time.
- [ ] **Step 3: Implement `managePage`** in `manage-page.ts` following frames M1–M5 in `specs/calvin-4/ux/epic-3.html` (lines 481–620). Order: private strip, brand, notice, pill, `kind` (capitalised format), `h1`, `when`, `where`, count (`<p class="count">N of M</p>`, not for called-off states), names list (full name after the token span; `names-on` for `on` and `happening_now`; `names-off` with `aria-label="Who was in"` for `not_this_time` and `was_on`), the decorative empty row for `needs_more`, then the link box (`<label for="public-link">Link to share</label>`, input `id="public-link"`, Copy button `id="copy"`, `copy-status` live region; omitted when called off), then `div.stack` with the actions. Call it off is shown only when the state is `needs_more` or `on` and `now` is before `plan.gatheringAt`. Pill text and class come from the exported public-page helpers, plus the " · decide by " suffix per the Ruling.
- [ ] **Step 4: Run to verify GREEN:** `npx vitest run src/web/views`
- [ ] **Step 5: Commit:** `git add src/web/views && git commit -m "Render the manage page"`

### Task 3: `GET /m/:token`

**Covers:** AC1, AC3, AC4, AC5, AC6, AC7

**Files:**
- Modify: `src/web/routes/manage.ts`, `src/web/routes/manage.test.ts`

**Interfaces:**
- Consumes: `loadManagePlan` (Task 1), `managePage` (Task 2), `displayState`, `deps.now()`, `config.baseUrl`, `isToken`, `layout`, `notFoundPage`.
- Produces: the route `GET /m/:token`. It sits beside `/m/:token/published`; Hono matches the exact path, so neither shadows the other.

- [ ] **Step 1: Write the failing tests** in `manage.test.ts` (`describe('GET /m/:token')`), with the real test database, `publishPlan` and `commit` for setup and `createApp(deps, { baseUrl: TEST_BASE_URL })`:
  - `shows the example plan (AC1)`: 200; the body contains `Your plan. Only you can see this page.`, `Needs 1 more · decide by`, `Ana Ruiz`, `Mia Chen`, `https://calvin.test/p/${publicToken}`, `href="/m/${manageToken}/new"` and `action="/m/${manageToken}/call-off"`; `<meta name="robots" content="noindex"` is present; no committer's email appears (AC6).
  - `shows It's on for a confirmed plan (AC3)`: a third commit confirms it; the body has `pill state-on` and `names names-on`.
  - `shows Not this time once called off (AC4)`: use a `fixedClock` past the deadline of an open plan; the body has `pill state-off`, `names-off`, `Who was in`, and no `Call it off`. This also pins the open-past-deadline Review Focus line.
  - `has no call-off once the gathering started (AC5)`: confirmed plan, `fixedClock` at an ISO literal just after the gathering; the body has `Happening now` and no `Call it off`.
  - `renders the too-late notice`: `?notice=too-late` shows its text; `?notice=anything-else` shows no `role="status"`.
  - `404s an unknown token, and a malformed one without a query (AC7)`: unknown `newToken()` gives 404 with `We can't find that plan.`; for `/m/not-a-token` and `/m/${'a'.repeat(200)}` the status is 404 with `noindex`, using deps whose `db` is a `Proxy` that throws on any property access (the database boundary), so a query would fail the test.
  - `loads create.js under the response nonce`: the same assertion as the published page's test, so Copy works.
- [ ] **Step 2: Run to verify RED:** `npx vitest run src/web/routes/manage.test.ts`. Expected: FAIL, 404 on `GET /m/:token`.
- [ ] **Step 3: Implement** the route in `manage.ts`: `isToken` first (malformed gives the 404 page without touching `deps.db`); `loadManagePlan`; `displayState(plan, deps.now())`; `managePage({ plan, state, publicLink: config.baseUrl + '/p/' + plan.publicToken, now: deps.now(), notice })` where `notice` is `'too-late'` only for that exact query value; `layout('Your plan: ' + plan.venue, page, { noindex: true, script: { src: '/static/create.js', nonce } })`, with the nonce taken as the published route does. The 404 uses `layout('Plan not found', notFoundPage(), { noindex: true })` as the other routes do.
- [ ] **Step 4: Run the whole suite:** `npx vitest run` and `npx tsc --noEmit`. Expected: both pass, request-logger and guardrail tests included.
- [ ] **Step 5: Commit:** `git add src/web && git commit -m "Serve the manage page at GET /m/:token"`
