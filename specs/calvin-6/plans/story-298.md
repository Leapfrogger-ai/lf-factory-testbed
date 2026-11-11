# Story 5.5 (#298): Called off by the creator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A plan the creator calls off tells the other committers "Ana called off Coffee at Blue Bottle. Nothing to do." and tells the creator nothing; the manage and public pages say the same thing in their own words.

**Architecture:** The wording is chosen when the email is built, from `plan.calledOffReason` (`'creator'` vs `'deadline'`), and the creator is skipped in the `sendToCommitters` activity for a creator call-off. Both stay on the existing `not_this_time` kind, so the ledger, the idempotency key, `planWorkflow` and its recorded histories are untouched (no new `patched()` id). The pages get the call-off reason and the creator's name from the loaders and pick their copy from them.

**Tech Stack:** Node 26 TypeScript (type stripping), Hono `html`, Drizzle, Temporal test env, Vitest 5.

**Spec:** .factory/story.md (story #298)

## Global Constraints

- Use Temporal's `patched()` / `deprecatePatch()` for any change to `planWorkflow` once plans are live, with a replay test against a recorded history; don't hand-roll version flags
- Workflow code imports only `@temporalio/workflow` and types, gets its schedule as epoch milliseconds, and uses neither `Intl` nor JS `Temporal` — workflow code must replay deterministically. ([ADR 0001](docs/adr/0001-temporal-workflow-per-plan.md))
- Every activity re-reads Postgres and acts only if the plan's state still matches (no reminder unless `confirmed`, no `not_this_time` unless `called_off`, nothing to withdrawn committers) — signals are hints, not state. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Every email is sent through `sendOnce`, with its payload built only from stored data — that's what makes each email go out exactly once and a retry identical. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md), [ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address — SQL and I/O stay in one module, and NFR006 holds by construction.
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed in. ([test-strategy](specs/calvin/test-strategy.md))
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine — [finding](specs/calvin/research/node-hono-drizzle.md).
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities. ([ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Tests verify behaviour through public interfaces, at the seams `specs/calvin/test-strategy.md` names — tests that reach inside break on every refactor.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- Vitest 5 runs every test. calvin has no build step, so the build command is the type check (`npx tsc --noEmit`, `npx vitest run`).
- Test database: `FACTORY_DB_NAME` on that server (default `calvin_test`); manual dev runs use `FACTORY_PORT_BASE + 0` (tests use `app.request()` and need no port).

Binding: CODING_STANDARDS.md, GLOSSARY.md, test-strategy.md, docs/adr/0001-temporal-workflow-per-plan.md, docs/adr/0002-postgres-owns-state-temporal-owns-time.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md

## Review Focus

- A plan called off at its deadline must be unchanged: the creator still gets "Not this time", and the public line keeps today's copy. Pinned in Tasks 1, 2, 3 and 5.
- A plan with only Ana in: no email at all, and the notice reads "Called off." Pinned in Tasks 2 and 4.
- A withdrawn committer gets neither email kind after a creator call-off. Pinned in Task 2.
- A retried send after a failed first attempt still delivers exactly one "Called off" email per committer. Pinned in Task 2.
- A forged `?notice=called-off` on a plan that is not called off shows no notice; the creator's name on the public line is HTML-escaped and capped at 16 characters (`firstName`). Pinned in Tasks 4 and 5.

---

## Fixture numbers (worked)

The example plan: Coffee at Blue Bottle, Sat 14 Nov 2026 10:00 PT = `2026-11-14T18:00:00Z`, minimum 3 unless stated. Existing workflow tests publish it with creator "Ann" / `ann@example.test`; this story's new tests publish with `{ name: 'Ana', email: 'ana@example.test' }` so the body can say "Ana".

- AC1 "open, Ana/Mia/Raj in": three commits against the default minimum of 3 confirm the plan, so publish with `minimum: '4'` to keep it open.
- AC2 "confirmed": `confirmedPlan({ name: 'Ana', email: 'ana@example.test' })` (minimum 3, three in) and call off at `2026-11-12T18:00:00Z`.
- AC3 "Ana and Mia at the deadline": two in against minimum 3 is below the minimum, so `resolveDeadline` calls it off.
- Expected recipients for a creator call-off: `['mia@example.test', 'raj@example.test']`.

## File Structure

- `src/email/templates.ts` — the `not_this_time` branch gains the creator-call-off wording.
- `src/temporal/activities.ts` — `sendToCommitters` skips the creator for a creator call-off.
- `src/domain/plans.ts` — `PublicPlan` gains `calledOffReason` and `creatorName`; `loadPublicPlan` and `loadManagePlan` select them.
- `src/web/views/manage-page.ts`, `src/web/routes/manage.ts` — confirmation copy, called-off notice, redirect.
- `src/web/views/public-plan-page.ts` — the called-off line.

---

### Task 1: The "Called off" email text

**Covers:** AC1, AC3, AC5

**Files:**
- Modify: `src/email/templates.ts` (the `not_this_time` branch)
- Test: `src/email/templates.test.ts`

**Interfaces:**
- Consumes: `buildEmail(kind, plan, commit, baseUrl, activeCommits)`; `plan.calledOffReason: 'deadline' | 'creator' | null`; `activeCommits` includes the creator's commit (`isCreator`), `firstName` from `public-plan-page.ts`.
- Produces: for `kind === 'not_this_time'` and `plan.calledOffReason === 'creator'`: subject `Called off: ${format} on ${day}`, text `${creatorFirstName} called off ${format} at ${venue}.` + ` Nothing to do.` + `\n` (format capitalised: "Coffee"), tag unchanged. Any other reason keeps today's output. Task 2 relies on this.

- [ ] **Step 1: Write the failing tests** in `describe('buildEmail not_this_time')`: the test file's `plan` has `calledOffReason: 'deadline'`. Add a second plan `{ ...plan, calledOffReason: 'creator' }` and the creator commit (name "Casey Creator") plus a joiner, both in `activeCommits`.
  - `'a creator call-off builds the Called off email'`: for the joiner, `subject` is `'Called off: Coffee on Sat 14 Nov'`, `text` is `'Casey called off Coffee at Blue Bottle. Nothing to do.\n'`, `to` is the joiner's email, tags `[{ name: 'kind', value: 'not_this_time' }]`.
  - `'a creator call-off email has no link, count or other name (AC5)'`: text has no `/w/`, no `withdrawToken`, no `/\d/`, no `Pat` (the joiner's name), and contains `Casey` only as the first name (no `Creator`).
  - The existing deadline tests stay as they are and must keep passing (AC3).
- [ ] **Step 2: Run** `npx vitest run src/email/templates.test.ts` → the two new tests FAIL (subject is "Not this time: …").
- [ ] **Step 3: Implement** in the `not_this_time` branch: when `plan.calledOffReason === 'creator'`, find the creator in `activeCommits` (`isCreator` is always true for one active commit: creators can't withdraw) and return the payload above; otherwise return the existing one.
- [ ] **Step 4: Run** `npx vitest run src/email/templates.test.ts && npx tsc --noEmit` → PASS, clean.
- [ ] **Step 5: Commit** `git add src/email && git commit -m "feat: Called off email text for a creator call-off"`

### Task 2: The creator gets no call-off email

**Covers:** AC1, AC3, AC9

**Files:**
- Modify: `src/temporal/activities.ts` (`sendToCommitters`)
- Test: `src/temporal/activities.test.ts` (`describe('sendToCommitters not_this_time')`)

**Interfaces:**
- Consumes: Task 1's email text; `plan.calledOffReason`; `callOff(deps, manageToken)` and `activities.resolveDeadline(planId)` from the existing tests' `setup(...)` (creator "Ann", `ann@example.test`).
- Produces: `sendToCommitters(planId, 'not_this_time')` sends to every active committer except the creator when `plan.calledOffReason === 'creator'`; unchanged for `'deadline'`. The workflow keeps calling it as today.

- [ ] **Step 1: Write the failing tests** (one at a time):
  - `'a creator call-off sends Called off to the others and nothing to the creator'`: setup with Mia and Raj and minimum `'4'`; `callOff(deps, published.manageToken)`; `sendToCommitters(planId, 'not_this_time')`; recipients are `['mia@example.test', 'raj@example.test']`, every subject starts `Called off: Coffee on Sat 14 Nov`, and the plan's `email.sent` events number 2 (via `loadPlan(db, manageToken).events`).
  - `'a creator call-off with only the creator in sends nothing'`: no other committers; zero calls.
  - `'a creator call-off sends nothing to a committer who withdrew'`: Mia and Raj in, Raj withdraws, then call-off: recipients `['mia@example.test']`.
  - `'a retry after a failed first Called off send still sends one each'`: `failNext()`, expect the first call to reject with `'email send failed'`, call again, recipients are Mia once and Raj once.
  - `'a deadline call-off still sends the creator Not this time'`: the existing first test already pins this; keep it unchanged.
- [ ] **Step 2: Run** `npx vitest run src/temporal/activities.test.ts -t not_this_time` → the first and third new tests FAIL (the creator is emailed).
- [ ] **Step 3: Implement** in `sendToCommitters`: filter `commits` for sending (not for the `activeCommits` argument, which the template needs to find the creator) so the creator is skipped when `kind === 'not_this_time' && plan.calledOffReason === 'creator'`.
- [ ] **Step 4: Run** `npx vitest run src/temporal/activities.test.ts && npx tsc --noEmit` → PASS (tests in this file that call off by the creator and expected "Not this time" for everyone, near the existing `callOff(` calls, are updated to the new behaviour in this step).
- [ ] **Step 5: Commit** `git add src/temporal && git commit -m "feat: the creator gets no email when they call a plan off"`

### Task 3: Workflow tests for both call-off paths, and the replay check

**Covers:** AC1, AC2, AC3, AC4, AC9, AC10

**Files:**
- Test: `tests/workflow/plan-workflow.test.ts` (`describe('planWorkflow call-off')` and the deadline tests)

**Interfaces:**
- Consumes: `confirmedPlan(overrides)`, `run(...)`, `runSchedule(...)` with `EXAMPLE`, `timedEmail`, `sent(deps)`, `startingWith(records, prefix)`, `calledOff` signal, `callOff` — all already in the file.
- Produces: nothing; `planWorkflow` is not changed.

- [ ] **Step 1: Update the existing creator call-off tests.** After Task 2 they fail where they expect `Not this time:` to `EVERYONE` after `callOff(deps, published.manageToken)`. Change those to expect `Called off: Coffee on Sat 14 Nov` to `['mia@example.test', 'raj@example.test']`, with `'Ann called off Coffee at Blue Bottle. Nothing to do.\n'`, and Ann receiving none. Leave `NOT_THIS_TIME` for the deadline tests. Do not touch the `replays …` tests or `tests/fixtures/workflow/*`.
- [ ] **Step 2: Add the new tests**, publishing with `{ name: 'Ana', email: 'ana@example.test' }`:
  - `'an open plan Ana calls off sends Mia and Raj Called off, and Ana nothing (AC1)'`: `publishPlan(deps, { minimum: '4', name: 'Ana', email: 'ana@example.test' })`, commit Mia and Raj, `run(deps, planId, 3_600_000, async (h) => { await callOff(deps, manageToken); await h.signal(calledOff); })`; expect exactly two emails with subject `'Called off: Coffee on Sat 14 Nov'` and text `'Ana called off Coffee at Blue Bottle. Nothing to do.\n'`, recipients Mia and Raj, no email to `ana@example.test`, and two `email.sent` events of kind `not_this_time` (`db.select().from(events)`).
  - `'a confirmed plan Ana calls off on Thu 12 Nov sends Called off once, no reminder, nothing to Ana (AC2)'`: copy the existing "between confirmation and the 24h reminder" test with `confirmedPlan({ name: 'Ana', email: 'ana@example.test' })`; Mia and Raj get one each, no `Tomorrow:`/`Today:`, Ana gets no `Called off:` and no `Not this time:`. (The confirmed email to Ana on confirmation is expected and not counted.)
  - `'a deadline call-off still sends Ana and Mia Not this time (AC3)'`: minimum `'3'`, Ana and Mia only, `run(deps, planId)`; both get `NOT_THIS_TIME` with `NOT_THIS_TIME_TEXT`.
  - `'the signal path sends the creator no email of any kind for the call-off (AC9)'` and `'the database path, with every calledOff signal failing, sends the creator no email of any kind for the call-off (AC4, AC9)'`: the second mirrors the existing test that calls `callOff(deps, published.manageToken)` without signalling and runs to the 24h reminder time; expect Mia and Raj one `Called off:` each and Ana none (no `Called off:`, `Not this time:`, `Tomorrow:`). For both, assert Ana's address appears in no email whose subject is not the `It's on:` one.
- [ ] **Step 3: Run** `npx vitest run tests/workflow/plan-workflow.test.ts` → the new tests pass; to prove they can fail, temporarily remove Task 2's creator filter, see AC1/AC2/AC4/AC9 tests FAIL, then restore it.
- [ ] **Step 4: Run** `npx vitest run tests/workflow tests/patched-ids.test.ts` → PASS with every `replays …` test passing, and `git diff main --stat -- tests/fixtures src/temporal/workflows.ts` is empty (AC10).
- [ ] **Step 5: Commit** `git add tests/workflow && git commit -m "test: call-off by the creator, by signal and through the database"`

### Task 4: Manage page: confirmation copy and the called-off notice

**Covers:** AC6, AC7

**Files:**
- Modify: `src/web/views/manage-page.ts` (`confirm`, the `notice` option), `src/web/routes/manage.ts` (GET `/m/:token`, POST `/m/:token/call-off`)
- Test: `src/web/views/manage-page.test.ts`, `src/web/routes/manage.test.ts`

**Interfaces:**
- Consumes: `managePage({ plan, state, publicLink, now, notice })`.
- Produces: `notice?: 'too-late' | 'called-off'` on `managePage`. `'called-off'` renders `<p class="notice" role="status">…</p>` above the pill, only when `state === 'not_this_time'`: `Called off. We've let the people who were in know.` when `plan.names.length > 1`, else `Called off.`. The POST redirects `outcome: 'called_off'` to `/m/${token}?notice=called-off`; `already_called_off` still redirects to `/m/${token}`.

- [ ] **Step 1: Write the failing view tests:** the confirmation test (existing line ~130) now expects `Call it off? Everyone who's in gets a short email saying you called it off.`; `'shows the called-off notice above the pill'` (names `['Ana', 'Mia']`, `'not_this_time'`) contains `<p class="notice" role="status">Called off. We've let the people who were in know.</p>` before `class="pill`; `'says only "Called off." when the creator was alone'` (names `['Ana']`); `'shows no called-off notice on a plan that is not called off'` (`'needs_more'`, `notice: 'called-off'` → no `class="notice"`).
- [ ] **Step 2: Write the failing route tests:** the POST test `'calls an open plan off'` expects location `/m/${manageToken}?notice=called-off`; the `'leaves a plan already called off alone'` second response keeps `/m/${manageToken}`; update the first-response expectation there. Add `'GET after the call-off shows the notice (AC7)'`: publish with Ana and Mia in (minimum 3, so open), POST call-off, GET the `location`, body contains the long notice; and `'… Ana alone → Called off.'`.
- [ ] **Step 3: Run** `npx vitest run src/web/views/manage-page.test.ts src/web/routes/manage.test.ts` → FAIL (copy and redirect).
- [ ] **Step 4: Implement:** change the `confirm` sentence; extend the `notice` option and render it where `tooLate` renders; in the route, map `c.req.query('notice')` to `'too-late' | 'called-off' | undefined` and redirect with `?notice=called-off` on `called_off`.
- [ ] **Step 5: Run** `npx vitest run src/web && npx tsc --noEmit` → PASS, clean.
- [ ] **Step 6: Commit** `git add src/web && git commit -m "feat: manage page says the call-off was a call-off and who was told"`

### Task 5: Public page line for a creator call-off

**Covers:** AC8

**Files:**
- Modify: `src/domain/plans.ts` (`PublicPlan`, `PlanRows`, `toPublicPlan`, `loadPublicPlan`, `loadManagePlan`), `src/web/views/public-plan-page.ts` (the `not_this_time` body)
- Test: `src/domain/plans.test.ts`, `src/web/views/public-plan-page.test.ts`, `src/web/routes/public.test.ts`

**Interfaces:**
- Consumes: `plans.calledOffReason`, `commits.isCreator`, `commits.name`; `firstName` from the view.
- Produces: `PublicPlan` gains `calledOffReason: 'deadline' | 'creator' | null` and `creatorName: string | null` (the creator's full name; the view shows `firstName`). The view's `not_this_time` line is `${firstName(creatorName)} called this one off. Nothing to do.` when `calledOffReason === 'creator'` and `creatorName !== null`, else today's `This one isn't going ahead. No harm done. Maybe next time.`; the pill stays "Not this time"; `publicPlanOg` is unchanged. Update the `plan()` builders in the view tests (and any other `PublicPlan` literal `npx tsc --noEmit` flags) to include both fields.

- [ ] **Step 1: Write the failing loader test** in `plans.test.ts`: after `callOff`, `loadPublicPlan` returns `calledOffReason: 'creator'` and `creatorName` of the creator; after `resolveDeadline` call-off, `'deadline'`; an open plan, `null`.
- [ ] **Step 2: Write the failing view tests:** a `called_off`/`'creator'` plan with `creatorName: 'Ana Smith'` contains `Ana called this one off. Nothing to do.`, the pill `Not this time`, and not `No harm done`; a `'deadline'` plan keeps `This one isn't going ahead. No harm done. Maybe next time.`; `creatorName: '<b>Ana</b>'` renders escaped; a 20-letter first name is cut to 16 characters.
- [ ] **Step 3: Write the failing route test** in `public.test.ts`: publish as Ana, call off through the manage route, GET `/p/:token` — the line and pill; and the link preview (`og:description`) still says `Not this time`.
- [ ] **Step 4: Run** `npx vitest run src/domain/plans.test.ts src/web` → FAIL.
- [ ] **Step 5: Implement:** left-join selects `plans.calledOffReason` and `commits.isCreator` in both loaders and `toPublicPlan` sets `creatorName` from the row whose `isCreator` is true; then the view change.
- [ ] **Step 6: Run** `npx vitest run && npx tsc --noEmit` → all PASS, clean.
- [ ] **Step 7: Commit** `git add src && git commit -m "feat: public page says the creator called it off"`

## Rulings

Ruling: The call-off email keeps the `not_this_time` kind and the ledger key `not_this_time/<plan>/<commit>`, with the wording chosen from `calledOffReason` — it keeps `email_sends` and `events` schemas and the workflow unchanged, as the story asks — it costs the email kind name no longer matching the subject in the event log.
Ruling: The email text ends with a newline, like the other templates and the existing "Not this time" body — the story's code fence doesn't show a trailing newline — it costs a test literal if the operator meant no newline.
Ruling: The creator is skipped in the activity, not the workflow — the activity already re-reads the plan, so the signal path and the database path share one rule and no `patched()` id is needed — it costs the activity knowing about the reason.
Ruling: The "Called off" notice is carried by a `?notice=called-off` redirect like `too-late`, and its text is chosen by `names.length > 1` at render — it keeps the route a thin redirect — it costs a forged query on a called-off plan showing a notice, which is harmless and shows nothing on other plans.
Ruling: The workflow tests publish the creator as "Ana" while older tests keep "Ann" — the existing fixtures pin `ann@example.test` and the story's text needs "Ana" — it costs two creator names in one test file.
