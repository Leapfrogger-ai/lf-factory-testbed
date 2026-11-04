# One look for every calvin page: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `public/app.css` to ux-spec §4 (calvin-4) and change the built pages' markup only as far as frames B1–B5 need, so every page looks like one app.

**Architecture:** The stylesheet is rewritten from the `.app` block of `specs/calvin-4/ux/epic-3.html` (selectors un-scoped: `.app x` becomes `x`), with the §4.1 token table on `:root` and the dark values in `@media (prefers-color-scheme: dark)`. Views stay pure functions in `src/web/views/`; a shared `brand` fragment in `layout.ts` puts the wordmark on every page. Tests read `public/app.css` as text and render views directly.

**Tech Stack:** Hand-written CSS, Hono `html` templates, Vitest 5, Node 26 native TypeScript.

**Spec:** .factory/story.md (story #201)

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
- Pages are plain HTML forms that work without JavaScript. (architecture.md)
- One hand-written CSS file with tokens (UX §3–4); < 10 KB. (architecture.md)
- Public page ≤ 2s over 4G: Server-rendered HTML, one CSS file < 10 KB, no JS, no web fonts. (architecture.md)
- `TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database. (test-strategy.md; this worktree's ports and database come from `FACTORY_PORT_BASE` and `FACTORY_DB_NAME`, so run tests as `npx vitest run` and never hard-code a port or database name.)
- Commands: test is `npx vitest run`; build is `npx tsc --noEmit`. (test-strategy.md)

Binding: CODING_STANDARDS.md, GLOSSARY.md, specs/calvin-4/test-strategy.md, specs/calvin-4/architecture.md, specs/calvin-4/ux-spec.md

## Review Focus

- A long or emoji first name ("😀" ×20, 16-code-point cap) must give one whole-emoji initial in the token, never half a surrogate pair. Pinned in Task 3.
- A committer name that starts with a lowercase letter, or whitespace first: the token shows the capitalised first letter of the first word. Pinned in Task 3.
- The plan over its minimum (4 names, minimum 3) shows no "you?" seat and no empty seats, and `Needs 0 more`. Pinned in Task 3 (existing tests keep this).
- Hidden elements: `.btn` sets `display:flex`, which beats the `hidden` attribute, so the JS-only Share button and the create page's row views would show without JS. Pinned in Task 1 (`[hidden]` rule) and Task 4.
- A venue or name containing markup is still escaped inside the new `h1.venue` and token. Pinned in Task 3 (existing escape tests keep this).

## Rulings

Ruling: Existing assertions `<h1>Blue Bottle</h1>` and `Oakland · Sat 14 Nov · 10:00 AM` in `public-plan-page.test.ts` become `<h1 class="venue">Blue Bottle</h1>` and two separate assertions (`Sat 14 Nov · 10:00 AM` in `.when`, `Oakland` in `.where`) — AC4 requires the time and the city on separate lines and the frames drop the joining "·", so these assertions pin markup, and every word of copy they check survives — if wrong, a reviewer reads it as a copy change; the words are identical so the cost is one comment.
Ruling: `was_on` ("This was on …") uses `state-off` and `seats-on` is not applied to it; `happening_now` uses `state-now` with `seats-on` — the frames draw neither; a finished gathering is neutral, a live one is green — recolouring is one class swap.
Ruling: Epic 3 only classes (`.private`, `.count`, `.names`, `.calloff`, `.confirm`, `.btn-dim`, `.stack`, `.card`) are kept in the stylesheet even though no built page uses them yet — the story says later stories use these classes — if the 10,240-byte cap is hit, minify whitespace before dropping a rule.
Ruling: The suggestion card keeps its no-JS shape (plain inputs inside `.card`); `create.js` only swaps its button classes (`quiet`, `btn btn-secondary`) — AC "works without JS" forbids moving to `<dl>` rows rendered only by script — a later story can add the ruled-row look to the inputs.

---

### Task 1: Rewrite the stylesheet

**Covers:** AC1, AC2

**Files:**
- Create: `src/web/app-css.test.ts`
- Modify: `public/app.css` (full rewrite)

**Interfaces:**
- Produces: the class names Tasks 2–5 use: `brand`, `state` + `state-open|state-on|state-off|state-now`, `kind`, `venue`, `venue-off`, `when`, `where`, `meta`, `copy`, `help`, `seats`, `seat`, `seat-you`, `seat-empty`, `seats-on`, `just-on`, `token`, `btn`, `btn-primary`, `btn-secondary`, `btn-dim`, `quiet`, `stack`, `linkbox`, `notice`, `notice-on`, `confirm`, `card`, `summary`, `field`, `row`, `row-view`, `row-edit`, `row-label`, `row-summary`, `error`, `again`.

- [ ] **Step 1: Write the failing tests** in `src/web/app-css.test.ts`, reading `public/app.css` with `node:fs` relative to the test file (`new URL('../../public/app.css', import.meta.url)`):
  - `defines every ux-spec 4.1 token on :root (light) and in the dark media block`: for each of the 16 tokens in §4.1 (`--paper #F5F3F8/#1A1720`, `--surface`, `--ink`, `--ink-2`, `--muted`, `--line`, `--line-strong`, `--berry`, `--berry-press`, `--berry-tint`, `--on-accent`, `--on`, `--on-tint`, `--off-tint`, `--error`, `--strip`, `--strip-text`) assert the `:root { … }` block (text before `@media (prefers-color-scheme: dark)`) declares `--token: <light hex>` and the dark media block declares `--token: <dark hex>`. Hex literals are typed in the test from ux-spec §4.1, not derived.
  - `has neither the old accent nor the old background`: `not.toMatch(/#B4502B/i)` and `/#FBF7F2/i`.
  - `is at most 10,240 bytes`: `Buffer.byteLength(css) <= 10240`.
  - `has no @font-face and no @import`.
  - `puts every animation and transition inside prefers-reduced-motion: no-preference`: strip comments, walk braces with a depth counter, find each `/\b(animation|transition)[\w-]*\s*:/` match, and assert its enclosing top-level block begins with `@media (prefers-reduced-motion: no-preference)`. Include a second case that feeds the helper a sample CSS string with a bare `transition:` and expects it to be flagged, so the helper can fail.
  - `hides [hidden] elements even when a class sets display`: `toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/)`.
- [ ] **Step 2: Run to verify RED:** `npx vitest run src/web/app-css.test.ts` — Expected: FAIL on tokens, old colours, and `[hidden]`.
- [ ] **Step 3: Rewrite `public/app.css`.** Take rules from the `.app` block (lines 10–130 of `specs/calvin-4/ux/epic-3.html`) with the `.app ` prefix removed; light tokens on `:root` (plus `--serif`, `--sans`, `--s1`…`--s6` from ux-spec §4.2–4.3, `color-scheme: light dark`), dark values in a single `@media (prefers-color-scheme: dark) { :root { … } }` (no `[data-theme]` selectors). Add the page base the frames get from `.app`: `*` border-box, `body` (background `--paper`, colour `--ink`, `font: 16px/1.5 var(--sans)`, margin 0), `main` (max-width 440px, centred, padding 16px 16px 24px), `[hidden]{display:none!important}`, `:focus-visible`. Add the classes from Task 1's Interfaces that are not in the block: `.again{margin-top:var(--s3)}`, `.row-view` as a flex row (min-height 52px, bottom border `--line`), `.row-view .quiet` / `.row-edit` spacing, `.card .field`. The `join` keyframe and the `animation` declarations stay inside `@media (prefers-reduced-motion: no-preference)`. Drop `.app .private`, `.count`, `.names` etc. only if the size cap forces it (see Ruling); prefer minifying whitespace.
- [ ] **Step 4: Run to verify GREEN:** `npx vitest run src/web/app-css.test.ts` — Expected: all pass; also run `wc -c public/app.css` and confirm ≤ 10240.
- [ ] **Step 5: Commit:** `git add public/app.css src/web/app-css.test.ts && git commit -m "Rewrite app.css to the calvin-4 tokens"`

### Task 2: The wordmark on every page

**Covers:** AC3

**Files:**
- Modify: `src/web/views/layout.ts`, `create-page.ts`, `published-page.ts`, `public-plan-page.ts`, `withdraw-page.ts`, `not-found-page.ts`, `system-error-page.ts` (all under `src/web/views/`)
- Create: `src/web/views/brand.test.ts`

**Interfaces:**
- Produces: `export const brand: HtmlEscapedString` in `layout.ts`, equal to `<p class="brand">calvin</p>`. Each page renders it as the first child of `<main>`.

- [ ] **Step 1: Write the failing test** `brand.test.ts` with one case per page: `createPage({ kind: 'inputs', values: {} }, {})`, `publishedPage({ publicLink, manageLink, emailed: true, shareText: 'x' })`, `publicPlanPage` (open plan, as in `public-plan-page.test.ts`'s `plan()`), `withdrawPage` for each of its four outcomes (called off, already started, withdrawn, the question), `notFoundPage()`, `systemErrorPage()`. Each asserts `html.indexOf('<p class="brand">calvin</p>') >= 0` and that it comes before `html.indexOf('<h1')`, and that `<h1` occurs once.
- [ ] **Step 2: Run to verify RED:** `npx vitest run src/web/views/brand.test.ts` — Expected: FAIL on every page except create.
- [ ] **Step 3: Implement** `brand` in `layout.ts` and use it in each view's `<main>` (create page swaps its inline `<p class="brand">` for the shared one).
- [ ] **Step 4: Verify:** `npx vitest run src/web/views` — Expected: PASS.
- [ ] **Step 5: Commit:** `git add src/web/views && git commit -m "Put the wordmark on every page"`

### Task 3: The public page in frame B3 and B4 markup

**Covers:** AC4, AC5, AC6

**Files:**
- Modify: `src/web/views/public-plan-page.ts`, `src/web/views/public-plan-page.test.ts`

**Interfaces:**
- Consumes: `brand` from Task 2; classes from Task 1.
- Produces: `publicPlanPage` signature unchanged. New internal `initial(name: string): string` (first code point of `firstName(name)`, upper-cased).

- [ ] **Step 1: Write the failing tests** (one at a time, RED between), added to `public-plan-page.test.ts`, using `plan({ names: ['Ana Ruiz', 'Mia Chen'], minimum: 3 })`:
  - AC4: output contains `<p class="state state-open">Needs 1 more</p>`, `<h1 class="venue">Blue Bottle</h1>`, `<p class="when">Sat 14 Nov · 10:00 AM</p>`, `<p class="where">Oakland</p>`, `<ul class="seats" aria-label="2 of 3 people in">`, `<span class="token" aria-hidden="true">A</span>`, same for `M`, exactly one `seat seat-you` containing `you?`.
  - AC5: `render(plan({ names: ['Ana','Mia','Raj'] }), 'on')` contains `state state-on`, `It's on`, `class="seats seats-on"` (and not `just-on`); with `{ notice: { code: 'on', n: 'Raj' } }` it contains `seats seats-on just-on`; `render(..., 'happening_now')` contains `state state-now` and `Happening now`.
  - AC6: with `notice: { code: 'on', n: 'Raj' }` the index of `role="status"` is less than the index of `class="state` and of `<h1`, and greater than the index of `class="brand"`; same for `{ code: 'closed' }` on `not_this_time`. The `on` notice has class `notice notice-on`.
  - Review Focus: `names: ['😀'.repeat(20)]` gives a token that is exactly one `😀`; `names: ['  mia chen']` gives token `M`; four names with minimum 3 shows no `seat-you`/`seat-empty`.
  - Update the three existing assertions named in the Ruling (`<h1>Blue Bottle</h1>`, `Oakland · Sat 14 Nov · 10:00 AM`, and any `class="seats"`/`dot` assertions) to the new markup; change no other expected string.
- [ ] **Step 2: Run to verify RED:** `npx vitest run src/web/views/public-plan-page.test.ts`
- [ ] **Step 3: Implement** in `public-plan-page.ts`: `pillText` stays; add `pillClass(state): 'state-open'|'state-on'|'state-off'|'state-now'` (`needs_more`→open, `on`→on, `happening_now`→now, `not_this_time` and `was_on`→off) and render `<p class="state ${cls}">`. Order inside `<main>`: brand, notice (if any), pill, `<p class="kind">` (replaces `eyebrow`), `<h1 class="venue">` (`venue venue-off` when `not_this_time`), `<p class="when">${formatWhen(...)}</p>`, `<p class="where">${plan.city}</p>`, body, commit form. Seats: `<li class="seat"><span class="token" aria-hidden="true">${initial}</span><span>${firstName}</span></li>`; the empty seats are `seat seat-you` ("you?", empty token) then `seat seat-empty` with an empty label span; the list class is `seats seats-on` for `on`, `happening_now` and `was_on` (`just-on` added only when `notice.code === 'on'`). Body paragraphs get `meta` (deadline line, "More people are welcome…") or `copy` (called-off text); "Suggest a plan" gets class `quiet`. `aria-label`s, notice copy and `role="status"` are unchanged. `formatWhen`'s output is the `when` line as is; if it returns the city or other text, adapt in this file only.
- [ ] **Step 4: Run to verify GREEN:** `npx vitest run src/web/views/public-plan-page.test.ts src/web/routes/public.test.ts`
- [ ] **Step 5: Commit:** `git add src/web/views && git commit -m "Restyle the public page markup to frames B3 and B4"`

### Task 4: The ready-to-share page in frame B2

**Covers:** AC7

**Files:**
- Modify: `src/web/views/published-page.ts`
- Create: `src/web/views/published-page.test.ts`

**Interfaces:**
- Consumes: `brand` (Task 2). `publishedPage` signature unchanged. `public/create.js` finds elements by id (`public-link`, `copy`, `share`, `copy-status`), so those ids stay.

- [ ] **Step 1: Write the failing test** `published-page.test.ts`: the page contains `<label for="public-link">Link to share</label>`; a `class="linkbox"` element that contains `<input` with `readonly` and `id="public-link"` and a `<button` with `id="copy"` and text `Copy` (assert by slicing from `class="linkbox"` to its closing `</div>`); the Share button has `btn btn-secondary`, `id="share"` and `hidden`; the manage link is `<a class="quiet" href="…">Manage your plan</a>`; both emailed and not-emailed copy variants still render their sentences (copy literals from the current file).
- [ ] **Step 2: Run to verify RED:** `npx vitest run src/web/views/published-page.test.ts`
- [ ] **Step 3: Implement** the markup from frame B2: label, `<div class="linkbox">` (input keeps its `aria-label`, Copy is `btn btn-primary`), Share `btn btn-secondary`, `copy-status` kept (aria-live), the emailed paragraph gets class `meta`, manage link class `quiet`.
- [ ] **Step 4: Run to verify GREEN:** `npx vitest run src/web/views/published-page.test.ts src/web/routes/create.test.ts`
- [ ] **Step 5: Commit:** `git add src/web/views && git commit -m "Restyle the ready-to-share page to frame B2"`

### Task 5: Create, withdraw, not-found and error pages; whole-suite check

**Covers:** AC3, AC8

**Files:**
- Modify: `src/web/views/create-page.ts`, `withdraw-page.ts`, `not-found-page.ts`, `system-error-page.ts`, `public/create.js`, and their existing tests only for changed class names.

**Interfaces:**
- Consumes: classes from Task 1.

- [ ] **Step 1: Write the failing tests** in `create-page.test.ts` (existing file): the card state wraps the format, where, when, minimum and decide-by fields in one `class="card"`; the "Change" link has class `quiet`; "Suggest another" and "Try suggesting again" buttons are `btn btn-secondary` inside a form with class `again`; the context line is `class="summary"`. In `withdraw-page.test.ts`: the "Withdraw" button keeps `btn btn-primary`; the withdraw question is the only `h1`. Not-found: "Suggest a plan" link has class `quiet`; the error page's "Start over" link has class `quiet`.
- [ ] **Step 2: Run to verify RED:** `npx vitest run src/web/views`
- [ ] **Step 3: Implement** those markup changes; in `public/create.js` give the Edit button class `quiet` and the Done button `btn btn-secondary` (no copy, ids or behaviour change). No copy, route, status code or behaviour changes.
- [ ] **Step 4: Run the full suite:** `npx vitest run` and `npx tsc --noEmit` — Expected: both pass.
- [ ] **Step 5: Check no copy assertion changed (AC8):** `git diff main -- '*.test.ts'` and read every removed `-` line that contains a quoted sentence; each must reappear unchanged on a `+` line (only the two Ruling assertions and class-name assertions differ). If a copy string differs, restore it and fix the markup instead.
- [ ] **Step 6: Commit:** `git add src public && git commit -m "Restyle create, withdraw, not-found and error pages"`
