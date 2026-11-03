# Commit to an open plan (Story 2.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An invitee can say "I'm in" on the public plan page with a name and email, and the page answers with a notice that replaces the form.

**Architecture:** A zod `commitFormSchema` validates the form. `commit()` in `src/domain/plans.ts` locks the plan row, refuses closed plans, upserts on `(planId, emailNormalized)` and appends `commit.added`, all in one transaction. `POST /p/:token/commit` in `src/web/routes/public.ts` validates, calls `commit()`, and redirects 303 to `/p/:token?notice=…&n=…`. `publicPlanPage` renders the form, the notice and the field errors.

**Tech Stack:** Node 26 + TypeScript (type stripping), Hono + `hono/html`, `@hono/zod-validator`, zod, Drizzle on Postgres 17, Vitest 5.

**Spec:** .factory/story.md (story #173)

## Global Constraints

- Plan and commit state changes only in `src/domain/plans.ts`, inside a transaction that locks the plan row and appends its event through `appendEvent` — one source of truth, and commit races settle on the row lock. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address — SQL and I/O stay in one module, and NFR006 holds by construction.
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed in. ([test-strategy](specs/calvin/test-strategy.md))
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Errors follow the architecture's Error Handling section: a field error re-renders the same page with 422 and keeps what was entered, any bad token is the same 404 page (a malformed one without a database query), a suggestion failure is a fallback card and never a 5xx, and anything unexpected goes to `app.onError` with no stack trace on the page — users never see a different error shape per route.
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities. ([ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use `c.req.parseBody()` and `@hono/zod-validator` with an error hook for forms; don't parse bodies by hand — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Drizzle's `onConflictDoUpdate` (target `[planId, emailNormalized]`) for a repeat commit; don't select-then-insert — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Drizzle's `db.transaction` and `.for('update')` for commit, confirm, call-off and deadline resolution; don't add application locks — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Hono's `app.request()` for route tests; don't add supertest or listen on a port — [finding](specs/calvin/research/node-hono-drizzle.md).
- Tests verify behaviour through public interfaces, at the seams `specs/calvin/test-strategy.md` names — tests that reach inside break on every refactor.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- Mock only at system boundaries, the four `deps` functions above plus the clock. A test never mocks a project module, `vi.mock`s a project file, or replaces a domain function with a spy.
- No implementation-coupled tests. Test through the seam's interface. A route test checks the response and the recorded boundary calls, not the database. A Plan operations test reads state back through `domain/plans.ts` functions, not with its own SQL. The one exception is the Send ledger seam: its test may count `email_sends` rows, because the ledger is its interface.
- Each route's outcome table in api-specification.md is that route's test list.
- `TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database.
- Each integration file resets the database before each test.
- Form requests must set `Content-Type: application/x-www-form-urlencoded`, or the validator sees `{}`, and must set `Origin: <BASE_URL>` to pass CSRF.
- No page, URL or redirect ever contains an email address.
- It never logs form bodies, query strings (they can hold `n`), emails, tokens or `Fly-Client-IP`.

Binding: CODING_STANDARDS.md, GLOSSARY.md, specs/calvin-3/test-strategy.md, specs/calvin-3/api-specification.md

## Review Focus

- A repeat commit typed as ` MIA@Example.test ` (padding, mixed case) must update Mia's one row, not add a second (FR013). Pinned in Task 1 and Task 2.
- A name or `n` containing markup (`<b>Mia</b>`) must appear escaped in the notice and the re-rendered form, never as an element. Pinned in Task 3.
- `GET /p/:token/commit`, and a POST to a malformed or unknown token, must be the 404 page; the malformed one without a database query. Pinned in Task 4.
- `?notice=in` with no `n`, an unknown `notice` value, or an `n` over 16 characters must render a sane page: no `undefined`, no notice for unknown values, name capped at 16. Pinned in Task 3.
- Two people sending the same new email at once must leave one commit row and not a 500 (the upsert and the row lock settle it). Pinned in Task 2.

---

## Rulings

Ruling: `commit()` never confirms the plan and sends no signal — Story 2.2 owns FR018 and the signals, and AC1 only needs "Needs 1 more" — if wrong, 2.2 adds the confirm step inside the same transaction.
Ruling: `commit()` produces `change` of `new` or `repeat` only; `rejoined` (a withdrawn commit returning) arrives with Story 2.3, which adds the withdraw that makes it reachable — if wrong, a withdrawn row would be revived as `repeat` once 2.3 lands without the branch.
Ruling: The refusal rule is coded as the spec states it (called off, or open and now ≥ deadline, or now ≥ gathering). Until Story 2.2 can confirm a plan, the "gathering started" case is only reachable on an open plan, where the deadline has also passed; AC6's test uses that — if wrong, nothing is stored either way.
Ruling: The 422 page puts the entered email back into its `value` attribute — AC4 requires entered values kept, and it is echoed only to the person who typed it, never to another visitor — if wrong, drop the email value and keep the name.
Ruling: The field-error mapping in `src/web/routes/create.ts` (`MISSING`, `schemaErrors`) moves to `src/web/field-errors.ts` so both routes share the copy — if wrong, it is a pure move with its existing tests as the guard.

---

### Task 1: Commit form schema and shared field errors

**Covers:** AC4

**Files:**
- Create: `src/web/field-errors.ts`
- Modify: `src/web/routes/create.ts` (remove `MISSING`, `Issue`, `schemaErrors`; import `schemaErrors` from `../field-errors.ts`), `src/web/forms.ts`
- Test: `src/web/forms.test.ts`

**Interfaces:**
- Produces: `commitFormSchema` and `type CommitForm = { name: string; email: string; emailNormalized: string }` from `src/web/forms.ts`; `schemaErrors(issues: readonly Issue[]): FieldErrors` from `src/web/field-errors.ts` (same behaviour as today's function in `create.ts`; `FieldErrors` stays exported from `views/create-page.ts`).

- [ ] **Step 1: Write the failing test** in `forms.test.ts`, `describe('commitFormSchema')`: `parses a padded mixed-case email into email and emailNormalized` (input `{ name: ' Mia Chen ', email: ' MIA@Example.test ' }` → `{ name: 'Mia Chen', email: 'MIA@Example.test', emailNormalized: 'mia@example.test' }`); `rejects an empty name` (issue path `['name']`); `rejects the email "mia@"` (issue path `['email']`); `rejects a name over 80 characters`.
- [ ] **Step 2: Run** `npx vitest run src/web/forms.test.ts` — Expected: FAIL, `commitFormSchema` is not exported.
- [ ] **Step 3: Implement** `commitFormSchema` in `forms.ts` reusing the existing `text(80)` and the publish form's email rule, with the same `emailNormalized` transform; export `CommitForm`.
- [ ] **Step 4: Run the same command** — Expected: PASS.
- [ ] **Step 5: Move `schemaErrors`** (pure move, no behaviour change) into `src/web/field-errors.ts`, import it in `create.ts`, and add `MISSING`-copy assertions only if one is not already covered by `routes/create.test.ts`. Run `npx tsc --noEmit && npx vitest run src/web` — Expected: PASS.
- [ ] **Step 6: Commit** — `git add src/web && git commit -m "feat: commit form schema; share field errors"`

### Task 2: `commit()` in the domain

**Covers:** AC2, AC3, AC5, AC6

**Files:**
- Modify: `src/domain/plans.ts`
- Test: `src/domain/plans.test.ts`

**Interfaces:**
- Consumes: `CommitForm` (Task 1); `appendEvent`; `loadPlan(db, manageToken)` for read-back; `publishPlan` and `fixedClock` from `tests/support`.
- Produces:
  ```ts
  export type CommitResult =
    | { outcome: 'not_found' }
    | { outcome: 'closed' }
    | { outcome: 'committed'; change: 'new' | 'repeat'; commitId: string; name: string };
  export async function commit(deps: Pick<AppDeps, 'db' | 'now'>, publicToken: string, form: CommitForm): Promise<CommitResult>
  ```
  `name` is the stored name after the upsert.

- [ ] **Step 1: Write the failing test** `commits a new person and records commit.added with change new` (example plan with Ana from `publishPlan`; Mia commits `mia@example.test`; read back with `loadPlan`: `count` 2, last event `{ type: 'commit.added', data: { change: 'new', isCreator: false, activeCount: 2 } }`).
- [ ] **Step 2: Run** `npx vitest run src/domain/plans.test.ts -t "change new"` — Expected: FAIL, `commit` not exported.
- [ ] **Step 3: Implement `commit`.** One `db.transaction`: select the plan `.for('update')` by `publicToken`; none → `not_found`. Closed (state `called_off`, or `open` with `now >= commitDeadlineAt`, or `now >= gatheringAt`, using `Temporal.Instant.compare`) → `closed` with no write. Otherwise `insert(commits).onConflictDoUpdate({ target: [planId, emailNormalized], set: { name } })` generating a fresh `withdrawToken` with `newToken()`, returning `id`, `name`, `isCreator` and `sql<boolean>\`(xmax = 0)\`` as `inserted`; `change` is `new` if inserted else `repeat`. Count active commits, then `appendEvent` `commit.added` with `change`, `isCreator`, `activeCount`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Next test, then code** — `a repeat with different case and a new name updates the one commit` (Mia then `MIA@Example.test` as "Mimi Chen"; `count` still 2, second event `change: 'repeat'`, `activeCount: 2`; result `name` is `Mimi Chen`). Run RED, fix, GREEN.
- [ ] **Step 6: Next test** — `refuses an open plan after its commit deadline` (`now` `2026-11-12T06:00:00Z`; result `{ outcome: 'closed' }`; `loadPlan` shows `count` 1 and only the `plan.published` and creator `commit.added` events). `refuses once the gathering has started` (same with `2026-11-14T18:00:00Z`). `returns not_found for an unknown token`. Each RED then GREEN; for the tests that pass on first run, mutate the closed check (drop one clause) to see them fail, then restore.
- [ ] **Step 7: Race test** — `two simultaneous commits with the same new email leave one commit` (`Promise.all` of two `commit` calls; `count` 2; exactly one `commit.added` with `change: 'new'` and one with `repeat`). Run; if it passes first time, show it can fail by temporarily removing `.for('update')`.
- [ ] **Step 8: Run** `npx tsc --noEmit && npx vitest run src/domain` — Expected: PASS. Commit — `git add src/domain && git commit -m "feat: commit() with row lock and upsert"`

### Task 3: Public page view — form, notices, field errors

**Covers:** AC1, AC4, AC8

**Files:**
- Modify: `src/web/views/public-plan-page.ts`, `public/app.css` (only what the notice and form need; no new stylesheet)
- Test: `src/web/views/public-plan-page.test.ts`

**Interfaces:**
- Consumes: `FieldErrors` from `views/create-page.ts`.
- Produces: `publicPlanPage({ plan, state, publicToken, notice?, form? })` where `notice?: { code: string; n?: string }` and `form?: { values: { name?: string; email?: string }; errors: FieldErrors }`; exported `firstName(fullName: string): string` (the existing helper, now exported).

Behaviour the tests pin:
- The form posts to `/p/${publicToken}/commit` with `method="post"`; `name` has `autocomplete="name"` and `autocapitalize="words"`; `email` has `type="email"` and `inputmode="email"`; help text "Only used to tell you if it's on. Never shown to anyone."; button **I'm in**. It shows for state `needs_more` and `on`, not for `not_this_time`.
- Notices (`role="status"`), copy from api-specification §R5: `in` "You're in, {n}. We'll email you if it's on."; `updated` "Updated: you're in as {n}."; `closed` "This one isn't taking commits any more." For `in` and `updated` the form is replaced by the notice; `closed` shows the notice and the form is shown only if the state allows it. An unknown `code` renders no notice. `n` is capped at 16 characters; with no `n`, `in` reads "You're in. We'll email you if it's on." and `updated` reads "Updated: you're in."
- Errors render as `<p class="error" id="name-error">` / `email-error` under the field, with `aria-describedby` and `aria-invalid="true"` on the input; entered values go back into `value`.

- [ ] **Step 1: Write the failing test** `shows the commit form with its attributes and help on an open plan` (assert the attributes above, the help line, **I'm in**, and `not.toContain('<script')`, exactly one `<link rel="stylesheet"` once wrapped in `layout`).
- [ ] **Step 2: Run** `npx vitest run src/web/views/public-plan-page.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the form in `publicPlanPage` following the field markup in `create-page.ts` (error paragraph and `aria-describedby`).
- [ ] **Step 4: Run** — Expected: PASS. Then one test at a time, RED then GREEN: `in notice replaces the form`; `updated notice`; `closed notice with no form on a not_this_time plan`; `unknown notice code renders nothing`; `no n and an n over 16 characters` (Review Focus); `escapes markup in n and in the kept name value` (Review Focus); `renders field errors under the fields and keeps the entered values`; `the seat row after Ana and Mia shows Ana, Mia and one you?` (plan with `names: ['Ana Ruiz', 'Mia Chen']`, `minimum: 3`; pill "Needs 1 more").
- [ ] **Step 5: Run** `npx tsc --noEmit && npx vitest run src/web/views` — Expected: PASS. Commit — `git add src public && git commit -m "feat: commit form and notices on the public page"`

### Task 4: `POST /p/:token/commit` and the page it leads to

**Covers:** AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8

**Files:**
- Modify: `src/web/routes/public.ts`
- Test: `src/web/routes/public.test.ts`

**Interfaces:**
- Consumes: `commitFormSchema` and `schemaErrors` (Task 1), `commit` and `CommitResult` (Task 2), `publicPlanPage` and `firstName` (Task 3), `isToken`, `loadPublicPlan`, `loadPlan` for read-back.
- Produces: the route R6. `GET /p/:token` also reads `notice` and `n` from the query (unknown values ignored) and passes them to the view.

Flow, in order: `isToken` fails → the not-found page, 404, no database query (a middleware before the validator); `zValidator('form', commitFormSchema, hook)` — on failure load the plan (miss → 404), re-render the public page with 422, `form: { values, errors: schemaErrors(issues) }`; then `commit()`; `not_found` → 404; `closed` → `c.redirect(\`/p/${token}?notice=closed\`, 303)`; `committed` → 303 to `/p/${token}?notice=${change === 'repeat' ? 'updated' : 'in'}&n=${encodeURIComponent(firstName(name))}`. No signals and no logging of the form (Story 2.2). Extract the GET handler's page rendering into one local function so GET and the 422 share it.

Tests (a `post(app, token, body)` helper in the test file sends `Content-Type: application/x-www-form-urlencoded` and `sameOrigin`), each RED then GREEN, one at a time:
- [ ] **Step 1: AC1** `Mia's commit redirects to notice=in and the page shows it` — `res.status` 303, `location` `/p/${publicToken}?notice=in&n=Mia`; GET that location: body (entity-decoded) contains "You're in, Mia. We'll email you if it's on.", "Ana", "Mia", exactly one "you?", "Needs 1 more", and no `name="email"`. Run `npx vitest run src/web/routes/public.test.ts -t "notice=in"` — Expected: FAIL (404 from the unrouted POST), then implement the route, then PASS.
- [ ] **Step 2: AC2** `a repeat commit with other case and name redirects with notice=updated` — second POST `MIA@Example.test` / "Mimi Chen" → `notice=updated&n=Mimi`; page reads "Updated: you're in as Mimi."; `loadPlan(...).count` is 2.
- [ ] **Step 3: AC3** `the events record new and repeat with the active count` — read `loadPlan(deps.db, manageToken).events`: `commit.added` entries `{ change: 'new', isCreator: false, activeCount: 2 }` then `{ change: 'repeat', isCreator: false, activeCount: 2 }`.
- [ ] **Step 4: AC4** `an empty name and the email "mia@" re-render with 422` — two cases: status 422; body contains the page's `<h1>Blue Bottle</h1>`, "Add your name." / "That email doesn't look right." with `id="name-error"` / `id="email-error"`, and the other entered field's value kept; `loadPlan` count stays 1.
- [ ] **Step 5: AC5** `a commit after the commit deadline is refused` — app built with `now: fixedClock('2026-11-12T06:00:00Z')`; 303 to `/p/${publicToken}?notice=closed`; the page shows "This one isn't taking commits any more."; count 1 and no new events.
- [ ] **Step 6: AC6** `a commit once the gathering has started is refused` — `now: fixedClock('2026-11-14T18:00:00Z')`; redirect `notice=closed`; nothing stored.
- [ ] **Step 7: AC7** `no email address in the redirect, the page or the log` — spy on `process.stdout.write` as `request-logger.test.ts` does (restore in `afterEach`); after the commit and the GET it leads to: `location`, the page body, and the joined log lines do not contain `mia@example.test` or `example.test`, and the log lines do not contain `publicToken`; the 303's log line has `path: '/p/:token/commit'`.
- [ ] **Step 8: AC8** `the page with the form still has no script and one stylesheet` — add to the GET test for an open plan: `not.toContain('<script')`, one `<link rel="stylesheet"`.
- [ ] **Step 9: Review Focus** — `GET /p/:token/commit is the 404 page`; `a malformed token POST is 404 and never touches the database` (throwing-db proxy as the existing test uses, valid CSRF headers); `an unknown token POST is 404`; `an unknown notice and an n over 16 characters on GET /p/:token` (no notice shown for `?notice=bogus`; `n` of 40 letters shows at most 16); `a name with markup commits and the notice escapes it`.
- [ ] **Step 10: Run** `npx tsc --noEmit && npx vitest run` — Expected: all PASS. Commit — `git add src && git commit -m "feat: commit on the public page"`

### Manual check

`npm run` has no script to start the app; the maintainer's manual dev run (`src/main.ts`, port `FACTORY_PORT_BASE + 0`) is not part of the automated tests at poc. Nothing in this story touches `main.ts`, `config.ts` or `public/create.js`, so no manual step is required.
