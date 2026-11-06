# Same again, new date: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /m/:token/new` (R9), the create page pre-filled from an old plan under the heading "Same again, new date", and let `POST /plans` publish it with `fromManageToken`.

**Architecture:** A new `again` state of the create page view carries the old plan's fields; `createPage` renders it in the suggestion-card shape without **Suggest another** or **Change**, with a hidden `fromManageToken`. `domain/plans.ts` gains `loadFromPlan` (lookup by manage token) and `publish` takes the old plan to set `from_plan_id` and the event's `fromPlanId`. The `POST /plans` route resolves the token before the suggestion, so a valid `fromManageToken` wins; the re-render paths (422, 429) rebuild the `again` state from the same token.

**Tech Stack:** Hono + `hono/html`, zod, Drizzle on Postgres, Vitest 5, Node 26 native TypeScript.

**Spec:** .factory/story.md (story #200)

## Global Constraints

- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `c.req.parseBody()` and `@hono/zod-validator` with an error hook for forms; don't parse bodies by hand — [finding](specs/calvin/research/node-hono-drizzle.md).
- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address — SQL and I/O stay in one module, and NFR006 holds by construction.
- Plan and commit state changes only in `src/domain/plans.ts`, inside a transaction that locks the plan row and appends its event through `appendEvent` — one source of truth, and commit races settle on the row lock. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Every email is sent through `sendOnce`, with its payload built only from stored data — that's what makes each email go out exactly once and a retry identical. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md), [ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Errors follow the architecture's Error Handling section: a field error re-renders the same page with 422 and keeps what was entered, any bad token is the same 404 page (a malformed one without a database query), a suggestion failure is a fallback card and never a 5xx, and anything unexpected goes to `app.onError` with no stack trace on the page — users never see a different error shape per route.
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities. ([ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Tests verify behaviour through public interfaces, at the seams `specs/calvin/test-strategy.md` names — tests that reach inside break on every refactor.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- No secret is read, stored, logged or committed other than as the architecture's Secrets table says (env vars from Fly secrets or a gitignored `.env`; never in `fly.toml`, the Dockerfile, the repo, a log line or a CI command line; `.env.example` holds names only) — a leaked secret can't be taken back.
- Pages are plain HTML forms that work without JavaScript. (architecture.md)
- `TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database. (test-strategy.md; this worktree's ports and database come from `FACTORY_PORT_BASE` and `FACTORY_DB_NAME`, so run tests as `npx vitest run` and never hard-code a port or database name.)
- Commands: test is `npx vitest run`; build is `npx tsc --noEmit`. (test-strategy.md)

Binding: CODING_STANDARDS.md, GLOSSARY.md, docs/adr/0002-postgres-owns-state-temporal-owns-time.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md, specs/calvin-4/test-strategy.md, specs/calvin-4/architecture.md

## Review Focus

- A malformed `fromManageToken` (not 43 chars, e.g. `abc`) must publish with no `from_plan_id` and never query the database or 500. Pinned in Task 2.
- A `fromManageToken` that belongs to a plan whose creator commit has since withdrawn or changed name: the page still renders from the creator commit's stored name and email. Pinned in Task 2.
- A 404 for `GET /m/<bad>/new` is the same not-found page as every other bad token (malformed token, no query). Pinned in Task 4.
- A 429 on the publish limit with a valid `fromManageToken` re-renders the "Same again, new date" page, not the suggest-a-plan one. Pinned in Task 4.
- Entered values are HTML-escaped on the 422 re-render of the again page (a name like `"><b>`). Pinned in Task 4.

## Rulings

Ruling: The new `again` state reuses the existing row markup, so `create.js` collapses the filled What/Where/Minimum rows into view rows with an edit button exactly as it does on the card; with JS off all fields are plain inputs — AC1 only needs the values shown and date/time/Decide by editable, and "works without JS" is the stronger rule — if wrong, a later change opens every row in `create.js` only.
Ruling: `GET /m/:token/new` lives in `createRoutes` (`src/web/routes/create.ts`), beside the helpers that render the create page, not in `manage.ts` — it shares `createLayout` and the state builders, and both files are mounted at `/` — if wrong, moving the handler is mechanical.
Ruling: The again page's `<title>` is "Same again, new date" and it is `noindex` (R9 says `noindex`) — the story only fixes the `h1`, and the title should follow it — if wrong, one string.
Ruling: When a valid `fromManageToken` and a `suggestionId` arrive together, `publish` receives no suggestion (so `suggestion_id` and `suggestion_edited` are null, and the stale-deadline rule is skipped) — api-specification R3 says `fromManageToken` wins — if wrong, the deadline default applies slightly differently.

---

### Task 1: `fromManageToken` in the form, and `publish` records the old plan

**Covers:** AC2, AC5, AC6

**Files:**
- Modify: `src/web/forms.ts`, `src/domain/plans.ts`
- Test: `src/domain/plans.test.ts`

**Interfaces:**
- Produces in `forms.ts`: `publishFormSchema` accepts an optional `fromManageToken: string` (trimmed, empty → undefined, no length check: an invalid one is "absent", not an error).
- Produces in `plans.ts`:
  - `export type FromPlan = { id: string; manageToken: string; city: string; area: string; timeWindow: string; format: string; venue: string; minimum: number; name: string; email: string }` (name and email are the old plan's creator commit).
  - `export async function loadFromPlan(db: Db, manageToken: string | undefined): Promise<FromPlan | null>` — null for undefined, a malformed token (`isToken` false, no query) or no match.
  - `publish(deps, form, suggestion?, from?: FromPlan)` — with `from`, stores `from_plan_id = from.id` and `plan.published` data `{ fromPlanId: from.id }`; without it `fromPlanId` stays `null`. A caller passes at most one of `suggestion` and `from`.

- [ ] **Step 1: Write the failing tests** in `src/domain/plans.test.ts`, one at a time with RED between. Setup: `publishPlan(deps, { name: 'Ana Ruiz', email: 'ana@example.test' })` for the old plan, then `commit` Mia onto it.
  - `loadFromPlan returns the old plan's fields and its creator's name and email`: expect `toMatchObject({ id, manageToken, city: 'Oakland', area: 'Rockridge', timeWindow: 'next weekend', format: 'coffee', venue: 'Blue Bottle', minimum: 3, name: 'Ana Ruiz', email: 'ana@example.test' })`.
  - `loadFromPlan is null for undefined, a malformed token and an unknown token`: `undefined`, `'abc'`, `newToken()`.
  - `publish with a from plan sets from_plan_id and the event's fromPlanId (AC2)`: publish `date: '2026-11-21'`, `time: '10:00'` with `from`; read the row with `loadPlan` and a select on `plans.fromPlanId`; expect it equals the old plan id, the `plan.published` event data equals `{ fromPlanId: <old id> }`, the new plan's tokens differ from the old plan's, the commits are exactly one creator commit named Ana Ruiz, and the old plan's `loadPlan` result is unchanged (still one more commit, Mia's, and the same state); `deps.fakes.planWorkflows.startCalls` has one entry whose `planId` is the new plan's.
  - `publish without a from plan leaves from_plan_id null (AC5)`: `fromPlanId` null in the row and the event.
- [ ] **Step 2: Run to verify RED:** `npx vitest run src/domain/plans.test.ts` — Expected: FAIL (`loadFromPlan` not exported; `fromPlanId` still null).
- [ ] **Step 3: Implement** the schema field in `forms.ts` (`fromManageToken: optional(z.string().trim())`, as `suggestionId` is) and `FromPlan`, `loadFromPlan` and the extra `publish` parameter in `plans.ts`. `loadFromPlan` joins `plans` to the creator commit (`isCreator = true`) and selects `commits.email` (the one place the address leaves the database besides `loadSendTarget`). `publish` writes `fromPlanId: from?.id ?? null` on the insert and in the event.
- [ ] **Step 4: Run to verify GREEN:** `npx vitest run src/domain/plans.test.ts` and `npx tsc --noEmit`.
- [ ] **Step 5: Commit:** `git add src/web/forms.ts src/domain && git commit -m "Record the old plan when publishing from it"`

### Task 2: `POST /plans` publishes from an old plan

**Covers:** AC2, AC3, AC5, AC6

**Files:**
- Modify: `src/web/routes/create.ts`
- Test: `src/web/routes/create.test.ts`

**Interfaces:**
- Consumes: `loadFromPlan`, `FromPlan`, `publish(deps, form, suggestion?, from?)` from Task 1.
- Produces: the publish handler passes `from` (and no suggestion) when `form.fromManageToken` resolves; otherwise behaves as today.

- [ ] **Step 1: Write the failing tests** in `src/web/routes/create.test.ts`, in a new `describe('POST /plans with fromManageToken')`, using the existing `post(deps, overrides)` helper; the old plan is `publishPlan(deps, { name: 'Ana Ruiz', email: 'ana@example.test' })` plus Mia's `commit` (`mia@example.test`), then `deps.fakes.email.calls.length = 0` is not allowed, so assert on emails by recipient instead:
  - `publishes a new plan from the old one (AC2)`: post `{ date: '2026-11-21', time: '10:00', name: 'Ana Ruiz', email: 'ana@example.test', fromManageToken: old.manageToken }` → 303 to `/m/<new manageToken>/published`; the new plan's manage token differs from the old; the row's `fromPlanId` is the old id; `loadPlan` shows one commit (the creator); `startCalls` has the new plan id; the old plan is unchanged (`loadPlan` count still 2).
  - `emails only the creator of the new plan (AC3)`: after that post, the `fakes.email.calls` entries to `ana@example.test` number exactly 2 (the old plan's manage link and the new one's), none went to `mia@example.test`, and the newest payload's text contains `/m/<new manageToken>`. Read the payload shape from `fakeEmail` usage in the existing "emails the creator their manage link once" test.
  - `an unknown fromManageToken publishes with no from_plan_id (AC5)`: `newToken()` and also `'abc'` → 303, `fromPlanId` null, event `fromPlanId` null.
  - `a valid fromManageToken beats a suggestionId (AC6)`: create an ok suggestion through the existing `suggestedLocation` helper, post both → `fromPlanId` is the old id and `suggestionId` is null.
- [ ] **Step 2: Run to verify RED:** `npx vitest run src/web/routes/create.test.ts -t "fromManageToken"` — Expected: FAIL on `fromPlanId`.
- [ ] **Step 3: Implement** in the `routes.post('/plans', …)` handler: `const from = await loadFromPlan(deps.db, form.fromManageToken)`; `const suggestion = from ? undefined : await okSuggestion(deps, form.suggestionId)`; pass `from` as `publish`'s fourth argument. `withoutStaleDeadline` keeps receiving the (possibly undefined) suggestion. The `sendOnce` call is unchanged (it already emails only the new creator).
- [ ] **Step 4: Run to verify GREEN:** `npx vitest run src/web/routes/create.test.ts` and `npx tsc --noEmit`.
- [ ] **Step 5: Commit:** `git add src/web/routes && git commit -m "Publish a plan from an old one with fromManageToken"`

### Task 3: The new-plan page in frame N1 markup

**Covers:** AC1, AC4

**Files:**
- Modify: `src/web/views/create-page.ts`
- Test: `src/web/views/create-page.test.ts`

**Interfaces:**
- Consumes: `FromPlan` from Task 1 (import the type).
- Produces: `CreateState` gains `{ kind: 'again'; from: FromPlan; values: FormValues; notice?: string }`. `createPage` for it renders `<h1>Same again, new date</h1>` (other kinds keep "Suggest a plan"), the summary line `Oakland · Rockridge · next weekend, morning` as `<p class="summary">` with no `Change` link, hidden inputs `city`, `area`, `timeWindow` and `fromManageToken` (= `from.manageToken`), no `suggestionId`, no suggest-again form, `data-publish-form="again"`. Field defaults: `format`, `venue`, `minimum`, `name`, `email` from `from`; date, time, deadlineDate and deadlineTime empty; entered `values` win over defaults (so a re-render keeps them). `name` and `email` need the `input` helper's `fallback` argument, which they don't use today.
- Also produces: `export const AGAIN_HEADING = 'Same again, new date'`.

- [ ] **Step 1: Write the failing tests** in `create-page.test.ts` with `from = { id, manageToken: 'M'.repeat(43), city: 'Oakland', area: 'Rockridge', timeWindow: 'next weekend, morning', format: 'Coffee', venue: 'Blue Bottle', minimum: 3, name: 'Ana Ruiz', email: 'ana@example.test' }`:
  - `the again page is headed "Same again, new date" and shows the card pre-filled (AC1)`: contains `<h1>Same again, new date</h1>`, not `Suggest a plan</h1>`, `value="Coffee"`, `value="Blue Bottle"`, `name="minimum"` with `value="3"`, `value="Ana Ruiz"`, `value="ana@example.test"`, `<input type="hidden" name="fromManageToken" value="MMMM…">`, `Oakland · Rockridge · next weekend, morning`; and the `date`, `time`, `deadlineDate`, `deadlineTime` inputs have `value=""`.
  - `the again page has no Suggest another, Change or suggestion link (AC1)`: html contains none of `Suggest another`, `Change`, `change=1`, `data-suggest-form`, `name="suggestionId"`, `name="previousSuggestionId"`.
  - `the again page keeps entered values and shows the error under the date (AC4 re-render)`: `values: { date: '', time: '10:00', name: 'Ana Ruiz' }`, errors `{ date: 'Pick a date.' }` → contains `<p class="error" id="date-error">Pick a date.</p>`, `aria-invalid="true"`, and the time input `value="10:00"`.
  - `escapes entered values on the again page`: `values: { name: '"><b>x' }` → no raw `<b>x`.
- [ ] **Step 2: Run to verify RED:** `npx vitest run src/web/views/create-page.test.ts` — Expected: FAIL (type error on `again` / missing heading).
- [ ] **Step 3: Implement** the `again` branch in `createPage`: derive `context`, `prefill` (with `name`/`email` added to every kind's prefill as `''`), heading text from kind, `changeId` undefined for `again`, the hidden `fromManageToken` input, and no trailing `suggestAgain`. Do not touch the markup of the other kinds.
- [ ] **Step 4: Run to verify GREEN:** `npx vitest run src/web/views` and `npx tsc --noEmit`.
- [ ] **Step 5: Commit:** `git add src/web/views && git commit -m "Render the same-again create page"`

### Task 4: `GET /m/:token/new`, and the again page on 422 and 429

**Covers:** AC1, AC4, AC7

**Files:**
- Modify: `src/web/routes/create.ts`
- Test: `src/web/routes/create.test.ts`

**Interfaces:**
- Consumes: `loadFromPlan` (Task 1), the `again` state and `AGAIN_HEADING` (Task 3), `notFoundPage` and `layout` (existing).
- Produces: route `GET /m/:token/new`; `stateFor` returns the `again` state when `values.fromManageToken` resolves; `createLayout` takes the page title and `noindex` for the again page.

- [ ] **Step 1: Write the failing tests** in `create.test.ts`, one at a time:
  - `GET /m/<manageToken>/new on a called-off plan renders the pre-filled page (AC1)`: old plan published with `name: 'Ana Ruiz'`, `email: 'ana@example.test'`, then called off at its deadline (use the existing helper the manage tests use to call a plan off, e.g. `resolveDeadline` after advancing the clock; look in `src/web/routes/manage.test.ts`); status 200, `<h1>Same again, new date</h1>`, the values from Task 3's AC1 test, the summary `Oakland · Rockridge · next weekend`, the response has `<meta name="robots" content="noindex"`, and no `Suggest another`/`Change`.
  - `renders for an open, confirmed and called-off plan (AC4)`: `it.each` over the three states (confirmed via `commit` of two more names to reach minimum 3 and `resolveDeadline`, as `plans.test.ts` does) → 200 and the heading.
  - `a malformed or unknown manage token is the not-found page with 404 (Review Focus)`: `/m/abc/new` and `/m/<newToken()>/new` → 404 and the body equals the body of `GET /m/abc` (the same page).
  - `a publish with no date re-renders the again page with 422 (AC7)`: post `{ date: '', time: '10:00', name: 'Ana Ruiz', email: 'ana@example.test', format: 'Coffee', fromManageToken }` → 422, `<h1>Same again, new date</h1>`, `<p class="error" id="date-error">Pick a date.</p>`, time input `value="10:00"`, `value="Coffee"`, `value="Blue Bottle"`, hidden `fromManageToken` still present, and `countPlans` unchanged.
  - `a publish rate-limited with a valid fromManageToken re-renders the again page with the notice (Review Focus)`: follow how the existing 429 publish test exhausts the limit; expect 429, the heading "Same again, new date" and `PUBLISH_LIMIT_NOTICE`.
  - `entered values are escaped on the again 422 (Review Focus)`: name `"><b>x` → body has no raw `<b>x`.
- [ ] **Step 2: Run to verify RED:** `npx vitest run src/web/routes/create.test.ts -t "new"` — Expected: FAIL (404 route missing; 422 shows "Suggest a plan").
- [ ] **Step 3: Implement** in `create.ts`: (a) `routes.get('/m/:token/new', …)`: `loadFromPlan(deps.db, token)`; null → `c.html(layout('Plan not found', notFoundPage(), { noindex: true }), 404)` as `manage.ts` does; else `createLayout` with `{ kind: 'again', from, values: {} }`. (b) `stateFor`: first `loadFromPlan(deps.db, values.fromManageToken)`; if found return `{ kind: 'again', from, values }`, ahead of the suggestion branch. (c) `createLayout(c, body, status?, again?)`: for the again page use title `AGAIN_HEADING` and `noindex: true` (keep the script option). (d) `renderPublishLimited` already goes through `stateFor`; make it use the again title too — derive `again` from the returned state's `kind`. `rerenderPublish` likewise.
- [ ] **Step 4: Run to verify GREEN:** `npx vitest run src/web/routes/create.test.ts` then the full suite `npx vitest run` and `npx tsc --noEmit` — Expected: both pass.
- [ ] **Step 5: Commit:** `git add src/web && git commit -m "Add GET /m/:token/new and keep the again page on errors"`
