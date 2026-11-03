# Suggest again, change, copy and share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A creator can ask for another suggestion, go back and change their inputs, and (with JS) edit card rows, copy and share the link, all on top of plain POST forms.

**Architecture:** `POST /suggest` accepts an optional `previousSuggestionId`, validated against `suggestions` and stored as `previous_suggestion_id` (null if it matches no row). The create page view gains the Suggest another / Try suggesting again forms, the Change link and the `change=1` inputs state. One static script, `public/create.js`, loaded with the response's CSP nonce, only enhances; the forms work without it.

**Tech Stack:** Node 26 (TypeScript type stripping), Hono 4 (`hono/html`, `hono/secure-headers`), Drizzle, zod, Vitest with embedded Postgres; plain browser JS for `create.js`.

**Spec:** .factory/story.md (story #130)

## Global Constraints

- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address — SQL and I/O stay in one module, and NFR006 holds by construction.
- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `c.req.parseBody()` and `@hono/zod-validator` with an error hook for forms; don't parse bodies by hand — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `hono/secure-headers` (with `NONCE` and `Referrer-Policy: no-referrer`) for security headers; don't set them by hand — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `hono/csrf` for CSRF protection on every POST; don't add hidden form tokens — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Hono's `app.request()` for route tests; don't add supertest or listen on a port — [finding](specs/calvin/research/node-hono-drizzle.md).
- Errors follow the architecture's Error Handling section: a field error re-renders the same page with 422 and keeps what was entered, any bad token is the same 404 page (a malformed one without a database query), a suggestion failure is a fallback card and never a 5xx, and anything unexpected goes to `app.onError` with no stack trace on the page — users never see a different error shape per route.
- Times are stored as UTC `timestamptz`, and every local-time rule and display format goes through `src/domain/time.ts` with `PLAN_TIME_ZONE` — one place for DST and the UX §8.8 formats.
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities. ([ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- No secret is read, stored, logged or committed other than as the architecture's Secrets table says (env vars from Fly secrets or a gitignored `.env`; never in `fly.toml`, the Dockerfile, the repo, a log line or a CI command line; `.env.example` holds names only) — a leaked secret can't be taken back.
- `src/main.ts`, `src/config.ts`, `src/temporal/client.ts`, `src/temporal/worker.ts`, `src/log.ts`'s transport and `public/create.js` have no automated tests at poc. The first story that touches each checks it by hand and records how in its plan.
- Tests use the worktree's own ports and database: the app port is `FACTORY_PORT_BASE + 0`, Postgres is `127.0.0.1:${FACTORY_PORT_BASE + 2}`, the test database is `FACTORY_DB_NAME` (default `calvin_test`); `vitest.config.ts` builds `TEST_DATABASE_URL`, so tests never read `.env`.

Binding: CODING_STANDARDS.md, GLOSSARY.md, specs/calvin-2/test-strategy.md, specs/calvin-2/architecture.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md

## Review Focus

- `previousSuggestionId` that is not a UUID (`not-a-uuid`, empty string, 36 junk characters): stored as null, no query error, no 5xx (Task 1).
- `previousSuggestionId` naming a *failed* suggestion row: valid, stored as the previous id (it is what "Try suggesting again" sends) (Task 1).
- `GET /?suggestion=<id>&change=1` for an unknown, malformed or failed-row id: the plain empty inputs state for unknown ids; for a failed row, inputs pre-filled from the row (Task 2).
- A 422 re-render of the card keeps **Suggest another** working (its hidden fields come from the stored suggestion, not the entered values) (Task 2).
- Values with quotes or `<script>` in `area` / `timeWindow` stay escaped in the hidden fields and in the pre-filled inputs (Task 2).

## File Structure

- Modify `src/web/forms.ts`: `suggestFormSchema` gains `previousSuggestionId`.
- Modify `src/domain/suggestions.ts`: `recordSuggestion` stores `previousSuggestionId`.
- Modify `src/web/routes/create.ts`: `/suggest` passes it; `GET /` handles `change=1`, passes the nonce.
- Modify `src/web/views/create-page.ts`: new forms, Change link, `change` state.
- Modify `src/web/views/layout.ts`: optional `script: { src; nonce }`.
- Modify `src/web/views/published-page.ts`, `src/web/routes/manage.ts`, `src/domain/time.ts`: Copy/Share markup and share text.
- Create `public/create.js`: the enhancement script (hand-checked).

### Task 1: `previousSuggestionId` on `POST /suggest`

**Covers:** AC1, AC2, AC3

**Files:**
- Modify: `src/web/forms.ts`, `src/domain/suggestions.ts`, `src/web/routes/create.ts`
- Test: `src/domain/suggestions.test.ts`, `src/web/routes/create.test.ts`

**Interfaces:**
- Consumes: `loadSuggestion(db, id): Promise<Suggestion | null>` (returns null for a non-UUID without a query and for no row).
- Produces: `suggestFormSchema` output has `previousSuggestionId?: string`; `recordSuggestion(deps, input, result, previousSuggestionId?: string | null): Promise<string>`, which stores `previous_suggestion_id` as given. The route is what resolves it to an existing row or null.

- [ ] **Step 1: Failing route tests** in `create.test.ts` (use `fakeSuggest(loadFixture('good'))`, `sameOrigin`, `testDeps`). Read the stored row with `db.select().from(suggestions)`: `previous_suggestion_id` is the one place a raw read is fine, since no domain reader exposes it.
  - `POST /suggest` with a first suggestion's id as `previousSuggestionId` → 303; the new row's `previousSuggestionId` equals the old id and `Location` is `/?suggestion=<new id>`; `GET` that location returns 200 containing the card's venue (AC1).
  - Same with the old id being a *failed* row (use `fakeSuggest(loadFixture('refusal'))` first), `previousSuggestionId` set; the new `GET` shows the new card (AC2).
  - `previousSuggestionId=3f2b8c1e-9d4a-4e6b-8a7c-5d1e2f3a4b5c` (no row), `not-a-uuid` and empty: 303, stored `previousSuggestionId` is null (AC3).
- [ ] **Step 2: Run** `npx vitest run src/web/routes/create.test.ts` — Expected: FAIL (column stays null).
- [ ] **Step 3: Implement.** `suggestFormSchema` adds `previousSuggestionId: optional(z.string().trim())` (reuse the `optional` helper in `forms.ts`; never a validation error). Add the fourth parameter to `recordSuggestion`, spread into the insert values. In `POST /suggest`: `const previous = await loadSuggestion(deps.db, form.previousSuggestionId ?? '')`, pass `previous?.id ?? null`.
- [ ] **Step 4: Run** the same command — Expected: PASS; then `npx vitest run src/domain/suggestions.test.ts` still PASS.
- [ ] **Step 5: Commit** `git add -A src && git commit -m "Store the previous suggestion on POST /suggest"`

### Task 2: Suggest another, Try suggesting again, Change

**Covers:** AC1, AC2, AC4

**Files:**
- Modify: `src/web/views/create-page.ts`, `src/web/routes/create.ts`
- Test: `src/web/views/create-page.test.ts`, `src/web/routes/create.test.ts`

**Interfaces:**
- Consumes: Task 1's `/suggest` contract.
- Produces: `CreateState` gains `{ kind: 'inputs'; values; previousSuggestionId?: string }` and `fallback` gains `previousSuggestionId?: string`. The card renders, outside the publish form (no nested forms): a link `<a href="/?suggestion=<id>&change=1">Change</a>` next to the summary line, and `<form method="post" action="/suggest">` with hidden `city`, `area`, `timeWindow`, `previousSuggestionId=<suggestion.id>` and a submit button **Suggest another**. The fallback renders the same form with button **Try suggesting again** when `previousSuggestionId` is set. The inputs state renders a hidden `previousSuggestionId` when set.

- [ ] **Step 1: Failing view tests** in `create-page.test.ts` (existing `okSuggestion`, `card()`, `fallback()` helpers): card HTML contains `href="/?suggestion=11111111-1111-4111-8111-111111111111&change=1"` (assert on whichever form hono actually emits, `&` or `&amp;`), and a `/suggest` form with hidden `previousSuggestionId` of `11111111-1111-4111-8111-111111111111`, `city` `Oakland`, `area` `Rockridge`, `timeWindow` `next weekend, morning`, and the text `Suggest another`; a fallback with `previousSuggestionId` shows `Try suggesting again`, one without shows no such form; an inputs state with `previousSuggestionId` has the hidden field, prefilled `area`/`timeWindow` values and selected city; `area` of `"><script>` is escaped everywhere it renders.
- [ ] **Step 2: Failing route tests:** `GET /?suggestion=<id>&change=1` for an ok row → 200, inputs form (`action="/suggest"`, no `action="/plans"`) with `value="Rockridge"`, the row's time window, `<option value="Oakland" selected`, hidden `previousSuggestionId=<id>` (AC4); for a failed row the same pre-fill; unknown id with `change=1` → plain empty inputs; `GET /?suggestion=<failed id>` fallback carries the hidden `previousSuggestionId` (AC2); a 422 `POST /plans` with `suggestionId` of an ok row (e.g. empty `name`) still renders the Suggest another form with that row's id.
- [ ] **Step 3: Run** `npx vitest run src/web` — Expected: FAIL on the new tests only.
- [ ] **Step 4: Implement** in `create-page.ts` (new `suggestAgain(context, previousId, label)` helper returning the form, used by the card and the fallback) and in `GET /` (when `change=1` and a row exists: `{ kind: 'inputs', values: { city, area, timeWindow }, previousSuggestionId: row.id }`; fallback state gets `previousSuggestionId: row.id`). `stateFor` (422 re-render) passes the card's suggestion as it already does; the fallback re-render after a failed publish has no id and shows no Try again form — Ruling below.
- [ ] **Step 5: Run** `npx vitest run src/web` — Expected: all PASS; `npx tsc --noEmit` clean.
- [ ] **Step 6: Commit** `git add -A src && git commit -m "Suggest another, Try suggesting again and Change"`

### Task 3: The create page loads `create.js` under the CSP nonce

**Covers:** AC5

**Files:**
- Modify: `src/web/views/layout.ts`, `src/web/routes/create.ts`, `src/web/routes/manage.ts`
- Create: `public/create.js` (empty IIFE stub here, filled in Task 5)
- Test: `src/web/views/layout.test.ts`, `src/web/routes/create.test.ts`

**Interfaces:**
- Produces: `LayoutOptions.script?: { src: string; nonce: string }` → `<script src="${src}" nonce="${nonce}" defer></script>` in `<head>`. Routes read the nonce with `c.get('secureHeadersNonce')`.

- [ ] **Step 1: Failing tests.** Layout: with `script: { src: '/static/create.js', nonce: 'abc' }` the page contains `<script src="/static/create.js" nonce="abc"`; without it no `<script`. Route: `GET /` (inputs), `GET /?suggestion=<ok id>` (card) and a 422 `POST /plans` each contain `<script src="/static/create.js" nonce="N"` where `N` is parsed from the response's `Content-Security-Policy` header (`'nonce-N'`), and `GET /static/create.js` is 200. AC5 second half: in the card page every `<form` has `method="post"` and an `action` of `/suggest` or `/plans`, and the page has no `onclick`/`onsubmit` attributes and no inline `<script>` without `src`.
- [ ] **Step 2: Run** `npx vitest run src/web/views/layout.test.ts src/web/routes/create.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the layout option; pass it from every `layout('Suggest a plan', …)` call in `create.ts` (extract one `createLayout(c, body, status?)` helper in that file). Create `public/create.js` as `(() => {})();`.
- [ ] **Step 4: Run** the same command plus `npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `git add -A src public && git commit -m "Load create.js under the CSP nonce"`

### Task 4: Published page markup and share text

**Covers:** AC5 (the page loads create.js under the nonce; behaviour checked by hand in Task 5)

**Files:**
- Modify: `src/domain/time.ts`, `src/web/views/published-page.ts`, `src/web/routes/manage.ts`
- Test: `src/domain/time.test.ts`, `src/web/routes/manage.test.ts`

**Interfaces:**
- Produces: `formatShareWhen(instant: Temporal.Instant): string` → `Sat 14 Nov 10:00 AM` (the day and clock of `displayParts`, joined by a space). `publishedPage` takes an extra `shareText: string`, rendered as `data-share-text` on a `<button type="button" id="share" hidden>Share…</button>`; the Copy button gets `id="copy"` and the link input `id="public-link"`; the Copy confirmation sits in an `aria-live="polite"` element.

- [ ] **Step 1: Failing tests.** `time.test.ts`: `formatShareWhen(Temporal.Instant.from('2026-11-14T18:00:00Z'))` is `'Sat 14 Nov 10:00 AM'`; also 2026-11-01T09:30:00Z (day of the DST change, 1:30 AM PDT) is `'Sun 1 Nov 1:30 AM'` — hand-check the 12-hour format against the existing `formatWhen` tests before fixing the literal. `manage.test.ts`: the published page of a plan from `publishPlan` has `data-share-text="Coffee at <venue>, Sat 14 Nov 10:00 AM — I'm in, who else?"` (use the builder's format/venue; the apostrophe is escaped as hono emits) and the `Share…` button with `hidden`.
- [ ] **Step 2: Run** `npx vitest run src/domain/time.test.ts src/web/routes/manage.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** The share text is `${capitalised format} at ${venue}, ${formatShareWhen(gatheringAt)} — I'm in, who else?`, built in `manage.ts` from `loadPublicPlan(deps.db, plan.publicToken)` (it has `format`, `venue`, `gatheringAt`). The page also loads `/static/create.js` through the Task 3 layout option.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add -A src && git commit -m "Published page hooks for copy and share"`

### Task 5: `public/create.js` and its hand checks

**Covers:** AC5

**Files:**
- Modify: `public/create.js`; give the card rows the hooks it needs in `src/web/views/create-page.ts` (rows wrapped as `<div class="row-field" data-field="where|when|minimum|decide">`, Edit buttons with `aria-label="Edit where"` etc. added by the script, so without JS every row is an input), plus `data-suggest-form` on the suggest forms and `data-publish-form` on the publish form.
- Test: none automated at poc (test-strategy). A one-line view test in `create-page.test.ts` that the hooks exist is the only automated part.

**Interfaces:**
- Consumes: Task 3's script tag, Task 4's `#copy`, `#share`, `#public-link`, `data-share-text`.
- Produces: behaviour, in plain browser JS with no dependencies:
  - Edit/Done toggles per card row; the opened input gets focus, **Done** returns focus to that row's Edit; Escape closes an open row. Fallback rows start open.
  - When `date`/`time` change and the creator has not edited `deadlineDate`/`deadlineTime` (track an `input` event on those two), recompute them: 48 h before When, or halfway between now and When if that is under 48 h away (mirror `defaultDeadline` in `src/domain/plan-rules.ts`; plain wall-clock arithmetic, ignoring DST — Ruling below).
  - On submit of a suggest form, disable its button and rotate its text between "Finding something nearby…" and "Picking a time…" (every 2s, inside an `aria-live="polite"` region; static under `prefers-reduced-motion`).
  - **Copy**: `navigator.clipboard.writeText(link)`, button reads "Copied" for 2s, then restores; no clipboard API → select the input text. **Share…**: unhide `#share` only if `navigator.share`; click calls `navigator.share({ text: dataset.shareText, url: link })`.
  - On submit of the publish form, disable **Publish plan** (after submit starts, so the POST is still sent).

- [ ] **Step 1: Failing view test** that the card has `data-field` rows, `data-suggest-form` and `data-publish-form`; run `npx vitest run src/web/views/create-page.test.ts` — Expected: FAIL.
- [ ] **Step 2: Add the hooks** to `create-page.ts`; same command — Expected: PASS.
- [ ] **Step 3: Write `public/create.js`** as above.
- [ ] **Step 4: Hand checks.** Run the app (`FACTORY_PORT_BASE` port, a fake or real key per `.env.example`) and, in a phone-sized browser window:
  1. With JS **off**: Suggest a plan, Suggest another, Change, Publish all work as plain POSTs (AC5).
  2. JS on: Edit/Done on each row, focus moves correctly, Escape closes.
  3. Change When on a card without touching Decide by: Decide by updates to 48 h before; edit Decide by, change When again: Decide by stays.
  4. Submit Suggest a plan: the button disables and the text rotates through "Finding something nearby…" and "Picking a time…".
  5. Published screen: **Copy** reads "Copied" for 2s then "Copy"; **Share…** appears only on a browser with `navigator.share` (check one without it) and opens the share sheet with the text "Coffee at Blue Bottle, Sat 14 Nov 10:00 AM — I'm in, who else?" (hand check beyond the story criteria).
  6. Double-tap **Publish plan**: one plan only.
  Record the browser and result of each in the commit message body.
- [ ] **Step 5: Run** `npx vitest run` and `npx tsc --noEmit` — Expected: PASS, clean.
- [ ] **Step 6: Commit** `git add -A src public && git commit -m "create.js: edit rows, deadline recompute, spinner, copy and share"`

## Rulings

Ruling: a 422 re-render of the fallback after a failed publish shows no Try suggesting again form — the publish form carries no suggestion id for a failed row, and adding one would change R3's contract — the creator reloads `/?suggestion=<id>` or starts from the inputs; low cost.
Ruling: `create.js` recomputes Decide by with plain wall-clock arithmetic, not `America/Los_Angeles` rules — the browser has no zone data we control and the server remains authoritative when the field is empty — a creator crossing a DST change may see Decide by an hour off the server's default, and can edit it.
Ruling: the Suggest another / Try suggesting again forms sit beside, not inside, the publish form — HTML forbids nested forms — none.
