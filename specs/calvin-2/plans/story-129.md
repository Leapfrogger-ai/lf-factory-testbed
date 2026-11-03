# Get a suggestion (story 1.7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /` opens on the inputs state; `POST /suggest` asks Claude for one plan, stores a `suggestions` row and redirects to `/?suggestion=<id>`, which renders the card or the fallback from that row; publishing from the card records `suggestion_id` and `suggestion_edited`.

**Architecture:** `src/suggest/suggest.ts` builds the Anthropic request and turns the response into an ok proposal or a failure reason, never throwing. `src/domain/suggestions.ts` stores and loads the row. The routes stay thin (`create.ts`), `createPage` renders three states, and `publish()` takes an optional loaded suggestion to set the link, the edited flag and the deadline (R3 rule 3). Every boundary (`suggestPlanCall`, `now`, `db`) is a `deps` argument.

**Tech Stack:** Node 26 (type stripping), Hono, zod, Drizzle + Postgres, `@anthropic-ai/sdk` 1.3, Vitest 5.

**Spec:** .factory/story.md (story #129)

Acceptance criteria are numbered in the order of `.factory/story.md`: AC1 is the good-response flow (303 and the card page), AC2 the request shape, AC3 failures, AC4 `invalid_proposal`, AC5 empty inputs (422), AC6 no second call on refresh, AC7 a bad `?suggestion=`, AC8 published unchanged, AC9 venue changed, AC10 When changed with default Decide by, AC11 fallback has no `suggestion_id`, AC12 latency by hand.

## Global Constraints

Rules from the repo's documents that bind this story, quoted verbatim.

- Use the Anthropic web search tool (`web_search_20260318`, `max_uses`, `user_location`) to check suggested venues; don't add a places API or scraping — [finding](specs/calvin/research/anthropic-api.md).
- Use Anthropic strict tool use (`strict: true` on `propose_plan`) for schema-valid suggestions; don't parse or repair free-text JSON — [finding](specs/calvin/research/anthropic-api.md).
- Use `@anthropic-ai/sdk`'s `timeout`, `maxRetries` and `signal` for the 20s hard limit; don't hand-roll `Promise.race` timers — [finding](specs/calvin/research/anthropic-api.md).
- Use Node 26's JS `Temporal` (`Temporal.ZonedDateTime` in `America/Los_Angeles`) for all local-time math; don't do manual offset math or add `date-fns-tz` or `luxon` — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `c.req.parseBody()` and `@hono/zod-validator` with an error hook for forms; don't parse bodies by hand — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Hono's `app.request()` for route tests; don't add supertest or listen on a port — [finding](specs/calvin/research/node-hono-drizzle.md).
- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address — SQL and I/O stay in one module, and NFR006 holds by construction.
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed in. ([test-strategy](specs/calvin/test-strategy.md))
- Times are stored as UTC `timestamptz`, and every local-time rule and display format goes through `src/domain/time.ts` with `PLAN_TIME_ZONE` — one place for DST and the UX §8.8 formats.
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Errors follow the architecture's Error Handling section: a field error re-renders the same page with 422 and keeps what was entered, any bad token is the same 404 page (a malformed one without a database query), a suggestion failure is a fallback card and never a 5xx, and anything unexpected goes to `app.onError` with no stack trace on the page — users never see a different error shape per route.
- Environment variables are read only in `src/config.ts` (and `DATABASE_URL` in `src/db/migrate.ts`), validated with zod at startup — one place says what the app needs.
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities. ([ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- No secret is read, stored, logged or committed other than as the architecture's Secrets table says (env vars from Fly secrets or a gitignored `.env`; never in `fly.toml`, the Dockerfile, the repo, a log line or a CI command line; `.env.example` holds names only) — a leaked secret can't be taken back.
- Tests verify behaviour through public interfaces, at the seams `specs/calvin/test-strategy.md` names — tests that reach inside break on every refactor.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- Every DST-sensitive rule has a test on 2026-11-01 and 2027-03-14 in `America/Los_Angeles` — that's where local-time rules break.
- Don't set `temperature`, `thinking: disabled` or a forced `tool_choice`: Sonnet 5.5 returns 400 for them.
- **Suggestion failure** (timeout, API error, no `propose_plan` call, `pause_turn`, `refusal`, `max_tokens`): log it at `warn`, record a `suggestion.requested` event with `outcome: "failed"`, and render the fallback card (FR004). Never a 5xx.
- A response without a `propose_plan` call, or one that ends in `pause_turn`, `refusal` or `max_tokens`, or takes longer than 20s, falls back to the empty form (FR004).
- Latency is the risk: the docs give no figures for search latency. NFR001 (≤15s p95) must be measured in the first suggestion story; dropping `max_uses` to 1 is the first lever.
- `TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database.
- Mock only at system boundaries, the four `deps` functions above plus the clock. A test never mocks a project module, `vi.mock`s a project file, or replaces a domain function with a spy.

Binding: CODING_STANDARDS.md, GLOSSARY.md, docs/adr/0004-suggestions-sonnet-web-search.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md, specs/calvin-2/test-strategy.md, specs/calvin-2/architecture.md

Commands (test-strategy.md): test `npx vitest run [path]`, build `npx tsc --noEmit`. This worktree's ports and database come from `FACTORY_PORT_BASE` and `FACTORY_DB_NAME`; tests never read `.env`. Every integration file resets the database in `beforeEach` with `resetDb(db)`.

## Review Focus

Inputs the story implies but no AC tests directly, most likely to bite first:

1. The model proposes a gathering that is already past (or not after `now`): the default deadline would land after the gathering and the DB check `plans_deadline_before_gathering_check`/the row would fail. Expect `invalid_proposal` and the fallback, never a 500. (Task 1)
2. The model's `format` or `venue` is whitespace-only or longer than the column allows (40 / 120): expect `invalid_proposal`, not a database error. (Task 1)
3. The model's venue contains HTML: the card must escape it. (Task 4)
4. `/plans` gets a `suggestionId` that is a UUID of a failed row, an unknown row, or not a UUID: treated as absent, plan has no `suggestion_id`, no error. (Task 6)
5. A suggestion whose gathering is now in the past still renders its card (R1); the publish validation, not the page, rejects it. (Task 4)

---

## File Structure

- Create `src/suggest/suggest.ts`: `SUGGEST_MODEL`, `MAX_SEARCH_USES`, `buildSuggestRequest`, `suggest`, `createSuggestPlanCall` (real SDK wrapper, no automated test).
- Create `src/domain/suggestions.ts`: `recordSuggestion`, `loadSuggestion`.
- Create `tests/fixtures/anthropic/{good,no-tool-call,pause-turn,refusal,max-tokens}.json`, `tests/support/fixtures.ts`.
- Modify `tests/support/fakes.ts` (`fakeSuggest` can fail), `src/web/app.ts` (typed `suggestPlanCall`, `AppConfig.anthropicModel?`), `src/main.ts` (real call), `src/domain/time.ts` (`localDateTime`), `src/domain/plan-rules.ts`, `src/domain/plans.ts`, `src/web/forms.ts`, `src/web/routes/create.ts`, `src/web/views/create-page.ts` (+ tests next to each).

---

### Task 1: `suggest()` turns a Claude response into a proposal or a failure

**Covers:** AC2, AC3, AC4

**Files:**
- Create: `src/suggest/suggest.ts`, `src/suggest/suggest.test.ts`
- Create: `tests/fixtures/anthropic/good.json`, `no-tool-call.json`, `pause-turn.json`, `refusal.json`, `max-tokens.json`, `tests/support/fixtures.ts`
- Modify: `tests/support/fakes.ts`, `src/web/app.ts` (the `AppDeps.suggestPlanCall` type)

**Interfaces:**
- Consumes: `localToInstant(date, time)` (`src/domain/time.ts`), `defaultDeadline(now, gatheringAt)` (`src/domain/plan-rules.ts`).
- Produces (in `src/suggest/suggest.ts`):
  ```ts
  export const SUGGEST_MODEL = 'claude-sonnet-5-5';
  export const MAX_SEARCH_USES = 2;
  export type SuggestInput = { city: string; area: string; timeWindow: string };
  export type SuggestRequest = ReturnType<typeof buildSuggestRequest>;
  export type SuggestResponse = { stop_reason: string | null; content: { type: string; name?: string; input?: unknown }[] };
  export type SuggestPlanCall = (request: SuggestRequest, options: { signal: AbortSignal }) => Promise<SuggestResponse>;
  export type FailureReason = 'timeout' | 'api_error' | 'no_proposal' | 'pause_turn' | 'refusal' | 'max_tokens' | 'invalid_proposal';
  export type Proposal = { format: string; venue: string; venueAddress: string | null; venueUrl: string | null; gatheringAt: Temporal.Instant; minimum: number };
  export type SuggestResult = ({ outcome: 'ok'; proposal: Proposal } | { outcome: 'failed'; failureReason: FailureReason }) & { latencyMs: number };
  export function buildSuggestRequest(input: SuggestInput, model?: string): {...};
  export function suggest(input: SuggestInput, deps: { suggestPlanCall: SuggestPlanCall; now: () => Temporal.Instant; model?: string }): Promise<SuggestResult>;
  ```
  `AppDeps.suggestPlanCall` becomes `SuggestPlanCall` (import the type into `app.ts`). `fakeSuggest(fixture: SuggestResponse)` keeps `calls: {request, options}[]`, and gains `failWith(error: Error)` so the next call rejects. `loadFixture(name: 'good' | 'no-tool-call' | 'pause-turn' | 'refusal' | 'max-tokens'): SuggestResponse` in `tests/support/fixtures.ts` reads `tests/fixtures/anthropic/<name>.json`.

- [ ] **Step 1: Write the fixtures.** `good.json` is a Message-shaped response: `content` holds a `server_tool_use` (web_search), a `web_search_tool_result`, a `text` block and a `tool_use` named `propose_plan` with `input: { format: "coffee", venue: "Highwire Coffee Roasters", venue_address: "5700 College Ave, Oakland, CA", venue_url: "https://example.test/highwire", date: "2026-11-14", time: "10:00", minimum: 3 }`, `stop_reason: "tool_use"`. The other four are edits of it: `no-tool-call` (text only, `end_turn`), `pause-turn` (`pause_turn`, server tool use only), `refusal` (`refusal`), `max-tokens` (`max_tokens`). Write `tests/support/fixtures.ts`. See the Rulings for why `good.json` is hand-written first.

- [ ] **Step 2: Write the failing test** `suggest.test.ts`. Clock `fixedClock('2026-11-09T18:00:00Z')`, input `{ city: 'Oakland', area: 'Rockridge', timeWindow: 'next weekend, morning' }`:
  - `request names the model, both tools and sets no forbidden parameter (AC2)`: `calls[0].request.model === 'claude-sonnet-5-5'`; the tool of type `web_search_20260318` equals `{ type: 'web_search_20260318', name: 'web_search', max_uses: 2, user_location: { type: 'approximate', city: 'Oakland', region: 'California', country: 'US', timezone: 'America/Los_Angeles' } }`; the tool named `propose_plan` has `strict: true`; the request has no `temperature`, no `thinking`, no `tool_choice` keys; `output_config.effort === 'low'`; `system` contains `coffee, drinks or a walk` and `Never propose hosting at someone's home`; the user message contains the city, area and time window; `options.signal` is an `AbortSignal`.
  - `returns the proposal from the good response`: `outcome 'ok'`, `format 'coffee'`, `venue 'Highwire Coffee Roasters'`, `venueAddress`, `venueUrl`, `gatheringAt.toString() === '2026-11-14T18:00:00Z'`, `minimum 3`.
  - `fails with the matching reason (AC3)` as `it.each`: `no-tool-call` → `no_proposal`, `pause-turn` → `pause_turn`, `refusal` → `refusal`, `max-tokens` → `max_tokens`; a call that rejects `new Error('boom')` → `api_error`; a rejection with an Error whose `name` is `APIConnectionTimeoutError` → `timeout`; the same with `APIUserAbortError` → `timeout`. Never throws.
  - `fails with invalid_proposal (AC4)` as `it.each` over edits of the good input: `minimum: 1`, `venue: ''`, `venue: '   '`, a 121-character venue, a 41-character format, `date: '2026-11-09'` with `time: '10:00'` (gathering already past), `date: '2026-02-30'`, and a missing `venue` key.
  - `an empty venue_address or venue_url becomes null`.
  - `latencyMs` is 0 under the fixed clock.

- [ ] **Step 3: Run it to see it fail.** `npx vitest run src/suggest/suggest.test.ts` → FAIL, module not found.

- [ ] **Step 4: Implement `src/suggest/suggest.ts`** with the interface above. `buildSuggestRequest` returns `{ model, max_tokens: 2048, output_config: { effort: 'low' }, system, messages, tools }` with the two tools and no `tool_choice`. The `propose_plan` input schema is simple, `additionalProperties: false`, every key required, no min/max constraints (research/anthropic-api.md): `format`, `venue`, `venue_address`, `venue_url` (strings, empty when unknown), `date` (`YYYY-MM-DD`), `time` (`HH:MM`, Pacific wall clock), `minimum` (integer). `suggest()` passes `{ signal: AbortSignal.timeout(20_000) }`, maps errors by `error.name` (`APIConnectionTimeoutError` and `APIUserAbortError` → `timeout`, else `api_error`), checks `stop_reason` (`pause_turn`, `refusal`, `max_tokens` before looking for the tool call), takes the first `tool_use` named `propose_plan` (none → `no_proposal`), and validates its `input` with a zod schema: `format` trimmed 1–40, `venue` trimmed 1–120, `minimum` integer ≥ 2, `date`/`time` formats, a real date, and `gatheringAt` strictly after `now()`; any failure → `invalid_proposal`. `latencyMs` is `now()` after minus `now()` before, in milliseconds. Do not use `Promise.race`.

- [ ] **Step 5: Retype the boundary.** `AppDeps.suggestPlanCall: SuggestPlanCall` in `src/web/app.ts`; update `fakeSuggest` in `tests/support/fakes.ts` as in Interfaces. Run `npx tsc --noEmit` and fix call sites.

- [ ] **Step 6: Run to verify.** `npx vitest run src/suggest/suggest.test.ts` → PASS; `npx tsc --noEmit` → no errors.

- [ ] **Step 7: Commit.** `git add src/suggest tests/fixtures tests/support src/web/app.ts && git commit -m "Suggest: build the Claude request and read the proposal (#129)"`

---

### Task 2: Store and load suggestions

**Covers:** AC3, AC7

**Files:**
- Create: `src/domain/suggestions.ts`, `src/domain/suggestions.test.ts`
- Modify: `src/domain/time.ts`, `src/domain/time.test.ts`

**Interfaces:**
- Consumes: `SuggestInput`, `SuggestResult` (Task 1); `suggestions` table (`src/db/schema.ts`); `defaultDeadline`.
- Produces:
  ```ts
  // time.ts
  export function localDateTime(instant: Temporal.Instant): { date: string; time: string }; // PLAN_TIME_ZONE wall clock, YYYY-MM-DD and HH:MM
  // suggestions.ts
  export type Suggestion = { id: string; city: string; area: string; timeWindow: string } & (
    | { outcome: 'ok'; format: string; venue: string; gatheringAt: Temporal.Instant; minimum: number; commitDeadlineAt: Temporal.Instant }
    | { outcome: 'failed'; failureReason: FailureReason });
  export function recordSuggestion(deps: Pick<AppDeps, 'db' | 'now'>, input: SuggestInput, result: SuggestResult): Promise<string>; // returns suggestions.id
  export function loadSuggestion(db: Db, id: string): Promise<Suggestion | null>; // null for a non-UUID without querying, and for no row
  ```

- [ ] **Step 1: Write failing tests for `localDateTime`** in `time.test.ts` with ISO literals: `2026-11-14T18:00:00Z` → `{ date: '2026-11-14', time: '10:00' }`; on 2026-11-01 `2026-11-01T08:30:00Z` → `01:30` (PDT) and `2026-11-01T09:30:00Z` → `01:30` (PST); on 2027-03-14 `2027-03-14T09:30:00Z` → `01:30` and `2027-03-14T10:30:00Z` → `03:30`. Run (FAIL), implement with `toZonedDateTimeISO(PLAN_TIME_ZONE)`, run (PASS).

- [ ] **Step 2: Write the failing tests** in `suggestions.test.ts` (`resetDb` in `beforeEach`, `testDeps()` with its default clock `2026-11-09T18:00:00Z`; read back only through `loadSuggestion`):
  - `stores an ok suggestion with the default commit deadline`: record the good proposal (gathering `2026-11-14T18:00:00Z`), load it: `outcome 'ok'`, `commitDeadlineAt.toString() === '2026-11-12T06:00:00Z'` (halfway; the gathering is under 7 days out but over 48h, so the hand-worked answer is min(48h before = 2026-11-12T18:00Z, halfway = 2026-11-12T06:00Z)), and the inputs.
  - `stores a failed suggestion with its reason (AC3)` for `refusal`: `outcome 'failed'`, `failureReason 'refusal'`.
  - `returns null for text that is not a UUID, and for an unknown UUID (AC7)`.

- [ ] **Step 3: Run it to see it fail.** `npx vitest run src/domain/suggestions.test.ts` → FAIL.

- [ ] **Step 4: Implement both functions.** `recordSuggestion` inserts one row: ok fills `format`, `venue`, `venueAddress`, `venueUrl`, `gatheringAt`, `minimum` and `commitDeadlineAt = defaultDeadline(deps.now(), gatheringAt)`; failed sets `failureReason` only; `latencyMs` always. `loadSuggestion` checks a case-insensitive UUID regex before querying.

- [ ] **Step 5: Run to verify.** `npx vitest run src/domain` → PASS.

- [ ] **Step 6: Commit.** `git add src/domain && git commit -m "Suggestions: store and load the row (#129)"`

---

### Task 3: `POST /suggest`

**Covers:** AC1, AC3, AC5

**Files:**
- Modify: `src/web/forms.ts`, `src/web/routes/create.ts`, `src/web/app.ts`
- Test: `src/web/forms.test.ts`, `src/web/routes/create.test.ts`

**Interfaces:**
- Consumes: `suggest`, `recordSuggestion`, `loadSuggestion`; `schemaErrors` and `rerender` in `create.ts`; `createPage(values, errors)` (still the old shape until Task 4).
- Produces: `suggestFormSchema` in `forms.ts` (zod object `city` in `CITIES`, `area` and `timeWindow` trimmed 1–200) and `type SuggestForm`; `AppConfig` gains `anthropicModel?: string`; route `POST /suggest` in `createRoutes(deps, config)` (update the call in `app.ts`).

- [ ] **Step 1: Write the failing tests** in `create.test.ts`, posting with `sameOrigin` and `fakeSuggest(loadFixture('good'))` in `testDeps({ suggestPlanCall })`:
  - `redirects 303 to /?suggestion=<id> and stores one ok row (AC1)`: status 303, `location` matches `^/\?suggestion=[0-9a-f-]{36}$`, one fake call, and `loadSuggestion(db, <id from location>)` is ok with venue `Highwire Coffee Roasters`.
  - `stores a failed row and still redirects for each failure (AC3)`: `it.each` over `no-tool-call`, `pause-turn`, `refusal`, `max-tokens` fixtures plus a fake that rejects, expecting 303 and the matching `failureReason`, never 5xx.
  - `answers 422 with the three messages and never calls Claude for empty inputs (AC5)`: body contains `Pick a city.`, `Add a rough area.`, `Add a rough time.`; zero fake calls; no row stored (id lookup is impossible, so assert through `fake.calls.length === 0`). Whitespace-only area and an unknown city give the same messages. The page keeps what was entered.
  In `forms.test.ts` add a case each for trimming and for a city outside `CITIES`.

- [ ] **Step 2: Run to see them fail.** `npx vitest run src/web` → FAIL (404 on `/suggest`).

- [ ] **Step 3: Implement the route.** `zValidator('form', suggestFormSchema, hook)`; the hook reuses `schemaErrors` and re-renders the inputs state with 422 (until Task 4 reuse `rerender`). The handler calls `suggest(form, { suggestPlanCall: deps.suggestPlanCall, now: deps.now, model: config.anthropicModel })`, `recordSuggestion`, logs `log.warn('suggestion failed', { failureReason })` when failed (the reason only, never the inputs), and `c.redirect('/?suggestion=' + id, 303)`. Pass `config` into `createRoutes`.

- [ ] **Step 4: Run to verify.** `npx vitest run src/web` and `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit.** `git add src/web && git commit -m "Suggest: POST /suggest stores the row and redirects (#129)"`

---

### Task 4: `GET /` renders inputs, card or fallback

**Covers:** AC1, AC3, AC6, AC7

**Files:**
- Modify: `src/web/views/create-page.ts`, `src/web/routes/create.ts`
- Test: `src/web/views/create-page.test.ts`, `src/web/routes/create.test.ts`, `src/web/headers.test.ts` if it breaks

**Interfaces:**
- Consumes: `loadSuggestion`, `Suggestion`, `localDateTime`, `formatWhen`/`formatDeadline` if shown.
- Produces: `createPage` reshaped to
  ```ts
  export type CreateState =
    | { kind: 'inputs'; values: FormValues }
    | { kind: 'card'; suggestion: Extract<Suggestion, { outcome: 'ok' }>; values: FormValues }
    | { kind: 'fallback'; values: FormValues; notice?: string; city: string; area: string; timeWindow: string };
  export function createPage(state: CreateState, errors: FieldErrors, cities?: readonly string[]): HtmlEscapedString;
  ```
  The state for a `/plans` 422 re-render is chosen in `create.ts` by a small `stateFor(values)` (card when `values.suggestionId` loads as ok, else fallback when `city`, `area` and `timeWindow` are present, else inputs).

Page contents (api-specification R1, UX mockups 1a–1c):
- inputs: the suggest form (`POST /suggest`): `city` select with no default, `area`, `timeWindow`, button **Suggest a plan**.
- card and fallback: a summary line `City · area · time window` (for the good fixture: `Oakland · Rockridge · next weekend, morning`), then the R3 form with hidden `city`, `area`, `timeWindow` (and hidden `suggestionId` on the card only), rows What/Where/When/Minimum/Decide by as inputs (`format`, `venue`, `date`+`time`, `minimum`, `deadlineDate`+`deadlineTime`), "You're the first one in" with `name` and `email`, **Publish plan**. The card is prefilled from the row (`date`/`time` from `localDateTime(gatheringAt)`, deadline from `localDateTime(commitDeadlineAt)`); the fallback has those empty and `minimum` 3, plus the notice "We couldn't come up with a suggestion just now. Fill in your own below, or try again.". Errors on the hidden `city`/`area`/`timeWindow` are shown in a list under the summary line. **Suggest another** and **Try suggesting again** are Story 1.8; don't add them here.

- [ ] **Step 1: Write failing route tests** in `create.test.ts` (create the suggestion by `POST /suggest` with the good fixture, then `GET` the location):
  - `shows the summary, the card rows and the publish form (AC1)`: body contains `Oakland · Rockridge · next weekend, morning`; inputs `name="format"` value `coffee`, `name="venue"` value `Highwire Coffee Roasters`, `name="date"` value `2026-11-14`, `name="time"` value `10:00`, `name="minimum"` value `3`, `name="deadlineDate"` value `2026-11-11`, `name="deadlineTime"` value `22:00` (06:00Z is 22:00 PST the day before), hidden `suggestionId`, `name="name"` and `name="email"`.
  - `shows the fallback for a failed suggestion (AC3)` for each failure: the notice text; `format`, `venue`, `date`, `time`, `deadlineDate`, `deadlineTime` empty; `minimum` value `3`; no `suggestionId` input.
  - `does not call Claude again when the page is requested twice (AC6)`: two GETs, then `fake.calls.length === 1`.
  - `answers 200 with the plain inputs state for ?suggestion= that is empty, not a UUID or unknown (AC7)`: `it.each` over `''`, `nope`, `00000000-0000-4000-8000-000000000000`; body contains the **Suggest a plan** button and no card; status 200.
  - `escapes HTML in the venue` (venue `<script>x</script>` in a hand-edited `good` copy): body has `&lt;script&gt;`, never the raw tag.
  - `still renders a card whose gathering is now in the past`: record with a clock before the gathering, then GET with `now` after it.

- [ ] **Step 2: Write failing view tests** in `create-page.test.ts` for the three states (inputs state keeps the city options-in-order and unselected-blank tests, moved from the old form; the minimum/Decide by/Publish tests move to the card and fallback states; escaping and aria-describedby tests stay). Rewrite assertions that assumed the single form; behaviour assertions on status, kept values and error text in the 422 tests of `create.test.ts` stay as they are.

- [ ] **Step 3: Run to see them fail.** `npx vitest run src/web` → FAIL.

- [ ] **Step 4: Implement** the reshaped `createPage` and the `GET /` handler: read `c.req.query('suggestion')`, `loadSuggestion`, choose the state; missing or null → inputs. The old `rerender` for `POST /plans` uses `stateFor`; for `POST /suggest` 422 it renders the inputs state.

- [ ] **Step 5: Run to verify.** `npx vitest run` (whole suite) and `npx tsc --noEmit` → PASS.

- [ ] **Step 6: Commit.** `git add src/web && git commit -m "Create page: inputs, suggestion card and fallback (#129)"`

---

### Task 5: Publishing from a suggestion (domain)

**Covers:** AC8, AC9, AC10, AC11

**Files:**
- Modify: `src/domain/plan-rules.ts`, `src/domain/plans.ts`, `tests/support/builders.ts`
- Test: `src/domain/plan-rules.test.ts`, `src/domain/plans.test.ts`

**Interfaces:**
- Consumes: `Suggestion` (Task 2).
- Produces:
  ```ts
  // plan-rules.ts
  /** R3 rule 3: true when the creator changed When but left Decide by at the suggestion's. */
  export function deadlineIsStale(
    submitted: { gatheringAt: Temporal.Instant; deadlineAt: Temporal.Instant },
    suggestion: { gatheringAt: Temporal.Instant; commitDeadlineAt: Temporal.Instant },
  ): boolean;
  // plans.ts
  export function publish(deps, form: PublishForm, suggestion?: Extract<Suggestion, { outcome: 'ok' }>): Promise<{ planId; publicToken; manageToken }>;
  // PlanView gains
  suggestionId: string | null; suggestionEdited: boolean | null;
  ```
  `deadlineIsStale` is true when the deadline equals the suggestion's `commitDeadlineAt` and the gathering differs from the suggestion's `gatheringAt`. `builders.publishPlan(deps, overrides, suggestion?)` forwards the suggestion.

- [ ] **Step 1: Write the failing tests.** In `plan-rules.test.ts` (ISO literals): stale when the gathering moved and the deadline is the suggestion's; not stale when both are unchanged; not stale when the deadline was changed; not stale when only the gathering equals. In `plans.test.ts`, with a suggestion made through `recordSuggestion` + `loadSuggestion` (good proposal, clock `2026-11-09T18:00:00Z`, deadline `2026-11-12T06:00:00Z`) and `publishPlan`:
  - `published without changes links the suggestion and is not edited (AC8)`: form fields from the suggestion (`format coffee`, venue `Highwire Coffee Roasters`, date `2026-11-14`, time `10:00`, minimum `3`, deadline `2026-11-11` `22:00`): `loadPlan` → `suggestionId === suggestion.id`, `suggestionEdited === false`.
  - `venue changed is edited (AC9)`: `suggestionEdited === true`; also true for a changed format, minimum, deadline, and for a venue that differs only by trailing spaces → false (compared after trimming).
  - `When changed with Decide by left at the suggestion's takes the default for the new When (AC10)`: date `2026-11-20`, deadline still `2026-11-11 22:00` → `commitDeadlineAt === '2026-11-18T06:00:00Z'`... compute by hand: now `2026-11-09T18:00Z`, gathering `2026-11-20T18:00Z` → 48h before = `2026-11-18T18:00Z`, halfway = `2026-11-15T06:00Z`, so the expected is `2026-11-15T06:00:00Z`; `suggestionEdited === true`.
  - `a plan published without a suggestion has none (AC11)`: `suggestionId === null`, `suggestionEdited === null`.

- [ ] **Step 2: Run to see them fail.** `npx vitest run src/domain` → FAIL.

- [ ] **Step 3: Implement** `deadlineIsStale` and the `publish` change: resolve the deadline (form deadline when present and not stale, else `defaultDeadline`), insert `suggestionId: suggestion?.id ?? null` and `suggestionEdited` (null with no suggestion, else true if any of format, venue (trimmed), gathering, minimum or the resolved deadline differs from the suggestion). Add the two fields to `loadPlan`.

- [ ] **Step 4: Run to verify.** `npx vitest run src/domain` and `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit.** `git add src tests && git commit -m "Publish: link the suggestion, record suggestion_edited, keep the deadline rule (#129)"`

---

### Task 6: `POST /plans` carries `suggestionId`

**Covers:** AC8, AC9, AC10, AC11

**Files:**
- Modify: `src/web/forms.ts`, `src/web/routes/create.ts`
- Test: `src/web/forms.test.ts`, `src/web/routes/create.test.ts`

**Interfaces:**
- Consumes: `loadSuggestion`, `deadlineIsStale`, `publish(deps, form, suggestion?)`.
- Produces: `publishFormSchema` accepts optional `suggestionId` (a trimmed string, empty → absent); the route loads it, ignores any row that is missing, malformed or `failed`, and applies rule 3 before the timing checks so the stale deadline is dropped (treated as both deadline fields empty) in the success path and in the validator hook's timing check.

- [ ] **Step 1: Write the failing route tests** through `POST /suggest` then `POST /plans` with `suggestionId` from the redirect, reading back with `loadPlan`:
  - `publishes the card unchanged (AC8)`: `suggestionId` and `suggestionEdited === false`.
  - `a changed venue is edited (AC9)`.
  - `changing When and leaving Decide by takes the default deadline, and does not fail the deadline check (AC10)`: choose a When *earlier* than the suggestion's Decide by (date `2026-11-11`, time `09:00`) so the old deadline would be after the gathering; expect 303 and `commitDeadlineAt === '2026-11-10T17:30:00Z'` (hand-worked: now `2026-11-09T18:00Z`, gathering `2026-11-11T17:00Z` is 47h away, so the default is halfway).
  - `a plan from the fallback form has no suggestion_id (AC11)`: fallback form without `suggestionId`.
  - `treats a failed, unknown or malformed suggestionId as absent` (Review Focus 4): 303, `suggestionId === null`.
  A `forms.test.ts` case: `suggestionId` blank parses to undefined.

- [ ] **Step 2: Run to see them fail.** `npx vitest run src/web` → FAIL.

- [ ] **Step 3: Implement** the schema field and route changes. Keep the rule in one helper in `create.ts` that takes the string form values and the loaded suggestion and returns the values with the deadline fields cleared when `deadlineIsStale` (using `localToInstant`), used by both the hook's `timingInput` and the handler.

- [ ] **Step 4: Run to verify.** `npx vitest run` and `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit.** `git add src/web && git commit -m "Publish form: carry suggestionId and follow the deadline rule (#129)"`

---

### Task 7: Wire the real call and measure it by hand

**Covers:** AC12

**Files:**
- Modify: `src/suggest/suggest.ts` (`createSuggestPlanCall`), `src/main.ts`, `.env.example` only if `ANTHROPIC_MODEL` is missing (names only)
- No automated test: `main.ts` and the SDK wrapper have none at poc (test-strategy.md). Check by hand and say how in the PR.

**Interfaces:**
- Produces: `createSuggestPlanCall(client: Anthropic): SuggestPlanCall`, calling `client.messages.create(request, { signal })` (cast the request where the SDK types don't know `web_search_20260318`). `main.ts` builds `new Anthropic({ apiKey: config.anthropicApiKey, timeout: 20_000, maxRetries: 0 })`, replaces the stub, and passes `anthropicModel: config.anthropicModel` in the app config. The key is read through `config.ts` only; never log it.

- [ ] **Step 1: Implement** the wrapper and wiring. `npx tsc --noEmit` → no errors; `npx vitest run` → PASS.
- [ ] **Step 2: NOT DONE HERE — post-merge hand check (testbed #150).** `good.json` stays a hand-written stand-in until #150 replaces it with a real capture. Original step: Capture the good fixture by hand. With a real key in the environment (a gitignored `.env`), start the app, submit Oakland / Rockridge / `next weekend, morning`, and save the real `propose_plan` response over `tests/fixtures/anthropic/good.json`, removing anything personal (the search results' page text, URLs that name a person). Re-derive `no-tool-call`, `pause-turn`, `refusal` and `max-tokens` from it. If the real proposal's date is not `2026-11-14 10:00`, adjust the Task 1 to 6 expectations that name the fixture's values. If the session has no network or no key, leave the hand-written fixture, and say so in the PR.
- [ ] **Step 3: NOT DONE HERE — post-merge hand check (testbed #150).** AC12 is unmeasured; no real Anthropic call in this pilot. Original step: Measure latency (AC12). Submit 10 suggestions for different cities, then read the p95 with `SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FROM suggestions WHERE outcome = 'ok';` against the dev database. If it is above 15000, set `MAX_SEARCH_USES = 1` (and the AC2 test's literal to 1), and re-measure. Put the 10 latencies and the p95 in the PR description. If the calls can't be made in this session, say that AC12 is unmeasured.
- [ ] **Step 4: Commit.** `git add src .env.example tests && git commit -m "Suggest: wire the real Anthropic call (#129)"`

---

## Rulings

Ruling: the first `good.json` fixture is written by hand in the documented response shape, and Task 7 replaces it with a real capture — the build session may have no network or API key, and a hand-written fixture still exercises every code path — the cost if wrong is that a real response differs in a way the tests didn't see (for example another `tool_use` field), found only at the hand check.
Ruling: effort is sent as `output_config: { effort: 'low' }` — the research finding names that field, and the story's `effort: "low"` has no other home in the Messages API — the cost if wrong is a 400 from the real API, found at the hand check.
Ruling: a proposal whose gathering is not after `now()` is `invalid_proposal` — the default deadline would otherwise land after the gathering and break `plans_deadline_before_gathering_check` on the `suggestions` row's later publish, and AC4's reason list is otherwise silent — the cost if wrong is a rare fallback for a proposal that could have been shown.
Ruling: no `suggestion.requested` event is written — `events.plan_id` is NOT NULL and its type list has no such value, and the `suggestions` row already records outcome, reason and latency — the cost if wrong is that the trial metrics read `suggestions`, not `events`, for suggestion outcomes.
Ruling: latency is `now()` after minus `now()` before — the standards forbid reading the clock outside `main.ts`, and the real `now` is a real clock — the cost if wrong is `0` in tests, which no test depends on.
Ruling: timeouts are mapped by the SDK error's `name`, not by racing a timer — the standards say to use the SDK's `timeout`, `maxRetries` and `signal` — the cost if wrong is a new SDK error name falling into `api_error`.
Ruling: `ANTHROPIC_MODEL` is honoured through an optional `AppConfig.anthropicModel` and defaults to `SUGGEST_MODEL` — `config.ts` already declares it and tests build `createApp` with only `baseUrl` — the cost if wrong is none for the default.
Ruling: **Suggest another**, **Try suggesting again**, `previousSuggestionId`, `?change=1`, `create.js` and the rate limits are not built here — they belong to stories 1.8 and 1.9 in `epics.md` — the cost if wrong is none for this story's ACs.
