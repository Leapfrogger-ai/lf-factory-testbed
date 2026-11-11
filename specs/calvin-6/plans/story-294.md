# Story 5.1: Shared look and end pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Epic 5's shared CSS rules and give every end page (P8, W3, W4, W5, X2) a way onward and its final copy.

**Architecture:** `public/app.css` gets the sheet's proposed rules appended. Three pure views (`public-plan-page.ts`, `withdraw-page.ts`, `system-error-page.ts`) change their markup; `create-page.ts` already marks the invalid select. No route, domain or schema code changes. Existing tests that pin the old copy change with the copy.

**Tech Stack:** TypeScript on Node 26, Hono `html` templates, Vitest 5 (`app.request()` route tests, embedded Postgres).

**Spec:** .factory/story.md (story #294)

## Global Constraints

- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Hono's `app.request()` for route tests; don't add supertest or listen on a port — [finding](specs/calvin/research/node-hono-drizzle.md).
- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address — SQL and I/O stay in one module, and NFR006 holds by construction.
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- `TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database.
- No secret is read, stored, logged or committed other than as the architecture's Secrets table says (env vars from Fly secrets or a gitignored `.env`; never in `fly.toml`, the Dockerfile, the repo, a log line or a CI command line; `.env.example` holds names only) — a leaked secret can't be taken back.

Binding: CODING_STANDARDS.md, GLOSSARY.md, specs/calvin-6/test-strategy.md

(Existing guard: `src/web/app-css.test.ts` caps `public/app.css` at 10,240 bytes — now 8,362 — forbids `@font-face`/`@import`, and requires every animation/transition inside `prefers-reduced-motion: no-preference`.)

## Review Focus

- A withdrawer whose plan has started and who has also withdrawn: the started view still wins and shows the link (Task 4).
- Markup escaping: the withdrawn paragraph interpolates the format; a hostile format stays escaped (Task 4).
- Exactly one "Suggest a plan" link per end page: the `not_this_time` public page keeps its single link, and the confirm view and `happening_now` get none (Tasks 3, 4).
- The happening-now window ends exactly at gathering + 3h: `was_on` shows the link, `happening_now` doesn't (Task 3).
- Every system error status (403, 413, 500) uses the new sentence (Task 5).

---

### Task 1: Shared CSS additions

**Covers:** AC1

**Files:**
- Modify: `public/app.css` (append after the `.row-edit` rules; plain selectors like the existing rules)
- Test: `src/web/app-css.test.ts`

**Interfaces:**
- Produces: classes `.errors`, `.lede`, `.context`, `.answers` for Stories 5.2 and 5.6.

- [ ] **Step 1: Write the failing test** in `src/web/app-css.test.ts`: `it('has the Epic 5 additions (ux/epic-5.html proposed CSS)')`, using the existing `css` constant and a helper `rule(selector: string): string` returning the declaration block of the first rule whose selector is exactly `selector` (regex-escape it). Assertions:
  - `rule('.btn[disabled]')` matches `/opacity:\s*0?\.65/` and `/cursor:\s*progress/`; `rule('.btn[disabled]:hover')` matches `/background:\s*var\(--berry\)/`
  - `rule('input::placeholder')` matches `/color:\s*var\(--muted\)/`
  - `rule('select[aria-invalid="true"]')` matches `/border-color:\s*var\(--error\)/`
  - `rule('.errors')` matches `/list-style:\s*none/` and `/padding:\s*0/`
  - `rule('.lede')` matches `/color:\s*var\(--ink-2\)/`; `rule('.context')`, `rule('.context .when')`, `rule('.context .kind')`, `rule('.answers')`, `rule('.answers .btn')` are each non-empty.
- [ ] **Step 2: Run** `npx vitest run src/web/app-css.test.ts` — Expected: FAIL (no `.btn[disabled]` rule).
- [ ] **Step 3: Append the rules**, copied from `specs/calvin-6/ux/epic-5.html` lines 144–154 with the `.app ` prefix dropped, under a `/* Epic 5 */` comment. The file stays ≤ 10,240 bytes.
- [ ] **Step 4: Run** the same command — Expected: PASS, including the byte-cap test.
- [ ] **Step 5: Commit** `git add public/app.css src/web/app-css.test.ts` then `git commit -m "Add Epic 5's shared CSS rules"`

### Task 2: Invalid city select is marked invalid

**Covers:** AC2

**Files:**
- Test: `src/web/routes/create.test.ts` (the test "rejects no city, empty area, empty rough time, each in its own error element")
- Modify: none expected (`create-page.ts` already emits `aria-invalid="true"` on the select when the city has an error)

- [ ] **Step 1: Extend that test** with `expect(body).toMatch(/<select[^>]*id="city"[^>]*aria-invalid="true"/)`.
- [ ] **Step 2: Run** `npx vitest run src/web/routes/create.test.ts -t "rejects no city"` — Expected: PASS on first run, since the markup exists. The standards require a shown failure: temporarily remove `aria-invalid="true"` from the select in `src/web/views/create-page.ts`, rerun and see FAIL, restore it, rerun and see PASS. If the first run FAILs instead, fix `create-page.ts` so the select carries `aria-invalid="true"` exactly when `errors.city` is set.
- [ ] **Step 3: Commit** `git add src/web/routes/create.test.ts` then `git commit -m "Pin aria-invalid on the city select"`

### Task 3: Public page of a plan that was on links onward (P8)

**Covers:** AC3

**Files:**
- Modify: `src/web/views/public-plan-page.ts` (`publicPlanPage`, the `body` branch for `state === 'was_on'`)
- Test: `src/web/routes/public.test.ts` (beside the `it.each` "a confirmed plan at $now reads")

**Interfaces:**
- Consumes: `DisplayState` value `'was_on'`; the `confirmedPlan(deps)` and `post(app, publicToken, form)` helpers already in `public.test.ts`.

- [ ] **Step 1: Write the failing tests.**
  - `'a plan that was on ends with a quiet Suggest a plan link to /'`: confirmed example plan (gathering `2026-11-14T18:00:00Z` = 10:00 AM Pacific; happening-now window ends `21:00Z`), Mia committed, app clock `fixedClock('2026-11-14T22:00:00Z')` (2:00 PM). Request `/p/${publicToken}`; the body contains `This was on Sat 14 Nov` and `<a class="quiet" href="/">Suggest a plan</a>`, and not `name="email"`.
  - `'a plan happening now has no Suggest a plan link'`: same setup at `2026-11-14T20:59:59Z`; body does not contain `Suggest a plan`.
- [ ] **Step 2: Run** `npx vitest run src/web/routes/public.test.ts -t "Suggest a plan"` — Expected: the first FAILs on the missing link; the second passes.
- [ ] **Step 3: Implement** in `publicPlanPage`: for `state === 'was_on'` render `filledSeats(plan, false, justOn)` then `<p><a class="quiet" href="/">Suggest a plan</a></p>`; `happening_now` keeps its current body. Link markup matches the `not_this_time` branch.
- [ ] **Step 4: Run** `npx vitest run src/web/routes/public.test.ts src/web/views/public-plan-page.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/web/views/public-plan-page.ts src/web/routes/public.test.ts` then `git commit -m "Offer Suggest a plan on a plan that was on"`

### Task 4: Withdraw pages (W3, W4, W5)

**Covers:** AC4, AC5

**Files:**
- Modify: `src/web/views/withdraw-page.ts` (`withdrawPage`)
- Test: `src/web/views/withdraw-page.test.ts`, `src/web/routes/withdraw.test.ts`

**Interfaces:**
- Consumes: `capitalise` (from `public-plan-page.ts`) and `formatDay` (from `domain/time.ts`), both already imported.

- [ ] **Step 1: Write the failing tests.**
  - `withdraw-page.test.ts`: replace the done-view test with one where `render(target({ withdrawn: true }))` matches `/<h1>You're out<\/h1>\s*<p[^>]*>You've withdrawn from Coffee on Sat 14 Nov\. No more emails about it\.<\/p>/`, contains `<a class="quiet" href="/">Suggest a plan</a>`, and has no `<button` or `<form`. The called-off view and the started view each keep their heading text and contain the same link and no `<form`. The confirm view does not contain `Suggest a plan`. With `format: '<i>x</i>'` and `withdrawn: true` the output holds `&lt;i&gt;x&lt;/i&gt;` and no `<i>`. In the "started wins over withdrawn" test the negative becomes `not.toContain("You're out")`.
  - `withdraw.test.ts`: the "withdraws, redirects to done" test (~line 87) asserts on the decoded body `<h1>You're out</h1>`, the paragraph `You've withdrawn from Coffee on Sat 14 Nov. No more emails about it.` and `<a class="quiet" href="/">Suggest a plan</a>`; the called-off test (~211) and the started test (~190) each add the link assertion. Fixtures are unchanged: Mia's token from `pageWith()` (minimum 4, Ana and Mia in), called off with `resolveDeadline`, started with `fixedClock('2026-11-14T18:00:00Z')`.
- [ ] **Step 2: Run** `npx vitest run src/web/views/withdraw-page.test.ts src/web/routes/withdraw.test.ts` — Expected: FAIL on the h1, the paragraph and the missing link.
- [ ] **Step 3: Implement** in `withdraw-page.ts`: a module-level `onward` fragment `<p><a class="quiet" href="/">Suggest a plan</a></p>` placed inside `<main>` of the called-off, started and withdrawn views (not the confirm view). The withdrawn view renders `<h1>You're out</h1>` then `<p class="copy">You've withdrawn from ${capitalise(target.format)} on ${formatDay(target.gatheringAt)}. No more emails about it.</p>`. The other two headings and the branch order (called off, started, withdrawn) are unchanged.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/web/views/withdraw-page.ts src/web/views/withdraw-page.test.ts src/web/routes/withdraw.test.ts` then `git commit -m "Give the withdraw end pages a way onward"`

### Task 5: System error page copy (X2)

**Covers:** AC6

**Files:**
- Modify: `src/web/views/system-error-page.ts`
- Test: `src/web/views/error-pages.test.ts`, `src/web/app.test.ts` (`COPY`, ~line 126), `src/web/routes/create.test.ts` (500 test, ~line 86)

- [ ] **Step 1: Write the failing test** in `error-pages.test.ts`: `String(systemErrorPage())` matches `/<h1>Something went wrong<\/h1>\s*<p>That didn't go through on our side\. Go back and try again in a minute\.<\/p>\s*<p><a class="quiet" href="\/">Start over<\/a><\/p>/`. Change `COPY` in `app.test.ts` and the literal in the `create.test.ts` 500 test to `That didn't go through on our side. Go back and try again in a minute.` (these cover the 403, 413 and 500 statuses).
- [ ] **Step 2: Run** `npx vitest run src/web/views/error-pages.test.ts src/web/app.test.ts src/web/routes/create.test.ts` — Expected: FAIL on the old sentence.
- [ ] **Step 3: Implement**: replace the `<p>` sentence in `systemErrorPage` with the new copy; heading and "Start over" link unchanged. The `html` template leaves literal apostrophes raw, so tests compare a raw apostrophe.
- [ ] **Step 4: Run** the same command, then `npx vitest run` and `npx tsc --noEmit` — Expected: all PASS.
- [ ] **Step 5: Commit** `git add src/web/views/system-error-page.ts src/web/views/error-pages.test.ts src/web/app.test.ts src/web/routes/create.test.ts` then `git commit -m "Say what happened on the system error page"`

## Rulings

Ruling: AC3's "2:00 PM" is the request time, not the gathering time; the example plan's gathering is 10:00 AM Pacific (`2026-11-14T18:00:00Z`) and its window ends 21:00Z, so the test clock is `2026-11-14T22:00:00Z` — the existing test pins 21:00Z as the first `was_on` instant — if wrong, the test still passes at any later instant.
Ruling: AC2 already holds in `create-page.ts`, so Task 2 is a regression pin proven by mutation rather than RED — the standards require a shown failure for a test that passes first time — it costs one temporary edit.
Ruling: the withdrawn paragraph gets `class="copy"` (an existing rule) — the sheet fixes the sentence, not the class — if the operator's 360px check dislikes the spacing, swap the class.
Ruling: existing tests that pin the old copy (`app.test.ts`, `create.test.ts`, `withdraw.test.ts`, `withdraw-page.test.ts`) change in the same task as the copy — they pin implementation copy, not acceptance-criterion text — it costs nothing.
