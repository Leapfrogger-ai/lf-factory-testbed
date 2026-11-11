# Story 5.3 (#296): Sharing and committing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the creator's private link safe when its email fails (a second copyable link box), and show invitees a relative "time left to decide" hint, plus the confirmed-plan email help line.

**Architecture:** One pure function in `src/domain/time.ts` turns a deadline and the request's `now` into the hint; `publicPlanPage` takes `now` as an argument (views do no I/O) and the route passes `deps.now()`. `publishedPage` gets the absolute manage URL and renders a second `linkbox` in the failed-email case; `public/create.js`'s Copy handler is generalised to every `linkbox` button.

**Tech Stack:** Node 26 TypeScript (type stripping), Hono `html`, JS `Temporal`, Vitest 5.

**Spec:** .factory/story.md (story #296)

## Global Constraints

- Use Node 26's JS `Temporal` (`Temporal.ZonedDateTime` in `America/Los_Angeles`) for all local-time math; don't do manual offset math or add `date-fns-tz` or `luxon`
- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine
- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time
- Times are stored as UTC `timestamptz`, and every local-time rule and display format goes through `src/domain/time.ts` with `PLAN_TIME_ZONE`
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string
- Tests verify behaviour through public interfaces, at the seams `specs/calvin/test-strategy.md` names
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call
- One test, then its implementation
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts
- Every DST-sensitive rule has a test on 2026-11-01 and 2027-03-14 in `America/Los_Angeles`
- `src/main.ts`, `src/config.ts`, `src/temporal/client.ts`, `src/temporal/worker.ts`, `src/log.ts`'s transport and `public/create.js` have no automated tests at poc. The first story that touches each checks it by hand and records how in its plan.
- Vitest 5 runs every test. calvin has no build step, so the build command is the type check. (`npx tsc --noEmit`, `npx vitest run`)
- App port (manual dev runs only; tests use `app.request()`) | `FACTORY_PORT_BASE + 0` (default 8080)
- Test database | `FACTORY_DB_NAME` on that server (default `calvin_test`)
- **Manage link**: The creator's private link to their plan. Through it they can call the plan off or start a new plan from it. It can't change a published plan.
- calvin's public, manage, withdraw and check-in tokens are 256-bit random strings (`randomBytes(32).toString('base64url')`), stored as plaintext `TEXT UNIQUE` columns on `plans` and `commits` and looked up by equality.

Binding: CODING_STANDARDS.md, GLOSSARY.md, test-strategy.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md

## Review Focus

- A deadline whose elapsed time is 24 h or more but falls on the same local calendar day (the 25-hour fall-back day, 2026-11-01): must read "(in 24 hours)", never "(today)" or "(in 0 days)". Pinned in Task 1.
- A deadline exactly 60 minutes away, and exactly 24 hours away: the hour and day branches start there ("(in 1 hour)", "(tomorrow)" or "(in 2 days)" by calendar). Pinned in Task 1.
- Elapsed time across spring-forward (2027-03-14): 22.5 real hours, not 23.5 wall-clock hours. Pinned in Task 1.
- A commit that fails validation (422) on a confirmed plan: the re-rendered form keeps the "details and reminders" help line. Pinned in Task 2.
- A published page for a failed-email plan: no "Manage your plan" link, no "Bookmark" text, and the manage URL is absolute (`BASE_URL/m/<token>`), while the emailed page keeps its relative `href="/m/<token>"` link and shows only one link box. Pinned in Task 3.

---

### Task 1: Relative deadline hint

**Covers:** AC3, AC4

**Files:**
- Modify: `src/domain/time.ts`
- Test: `src/domain/time.test.ts`

**Interfaces:**
- Produces: `export function formatDeadlineHint(deadline: Temporal.Instant, now: Temporal.Instant): string` returning the text *inside* the brackets, e.g. `"in under an hour"`, `"in 5 hours"`, `"tomorrow"`, `"in 2 days"`. Task 2 wraps it in `(` `)`.

Rules: elapsed < 1 h → `in under an hour`; elapsed < 24 h → `in N hours`, N = whole hours rounded down (N = 1 reads `in 1 hour`); otherwise days = whole calendar days between `now`'s and `deadline`'s local dates in `PLAN_TIME_ZONE`: 1 → `tomorrow`, ≥ 2 → `in N days`. If elapsed ≥ 24 h but calendar days is 0 (25-hour fall-back day), use the hours branch. Elapsed is real elapsed time (instants), not wall-clock.

- [ ] **Step 1: Write the first failing test** in `src/domain/time.test.ts`, `describe('formatDeadlineHint')`, test `'counts calendar days for 48 h away (AC3)'`: now `2026-11-10T18:00:00Z` (Tue 10 Nov 10:00 AM), deadline `2026-11-12T18:00:00Z` → `'in 2 days'`.
- [ ] **Step 2: Run** `npx vitest run src/domain/time.test.ts` → FAIL, `formatDeadlineHint` is not exported.
- [ ] **Step 3: Implement** `formatDeadlineHint` in `src/domain/time.ts` with the rules above; use `Temporal.Instant.until` for elapsed and `Temporal.PlainDate.until` of the two zoned local dates for calendar days.
- [ ] **Step 4: Run** the file → PASS.
- [ ] **Step 5: Add the remaining cases, one at a time** (each is RED before the code handles it, or shown RED by a mutation), expected values worked by hand:

| now (UTC) | deadline (UTC) | expected | why |
|---|---|---|---|
| `2026-11-11T17:00:00Z` (Wed 9:00 AM) | `2026-11-12T18:00:00Z` | `tomorrow` | 25 h, local dates 11 → 12 |
| `2026-11-12T13:00:00Z` (Thu 5:00 AM) | `2026-11-12T18:00:00Z` | `in 5 hours` | 5 h |
| `2026-11-12T17:30:00Z` (Thu 9:30 AM) | `2026-11-12T18:00:00Z` | `in under an hour` | 30 min |
| `2026-11-12T17:00:01Z` | `2026-11-12T18:00:00Z` | `in under an hour` | 59 min 59 s |
| `2026-11-12T17:00:00Z` | `2026-11-12T18:00:00Z` | `in 1 hour` | exactly 60 min |
| `2026-11-12T13:30:00Z` | `2026-11-12T18:00:00Z` | `in 4 hours` | 4 h 30 min rounds down |
| `2026-11-11T18:00:00Z` | `2026-11-12T18:00:00Z` | `tomorrow` | exactly 24 h, dates 11 → 12 |
| `2026-11-11T07:00:00Z` (Tue 10 Nov 11:00 PM) | `2026-11-12T09:00:00Z` (Thu 12 Nov 1:00 AM) | `in 2 days` | 34 h, local dates 10 → 12 |
| `2026-11-01T07:30:00Z` (Sun 12:30 AM PDT) | `2026-11-02T07:30:00Z` (Sun 11:30 PM PST) | `in 24 hours` | fall back: 25-hour day, 24 h elapsed, same local date |
| `2026-10-31T17:00:00Z` (Sat 10:00 AM PDT) | `2026-11-01T18:00:00Z` (Sun 10:00 AM PST) | `tomorrow` | 25 h across the 2026-11-01 transition, dates 31 Oct → 1 Nov |
| `2027-03-13T17:30:00Z` (Sat 9:30 AM PST) | `2027-03-14T16:00:00Z` (Sun 9:00 AM PDT) | `in 22 hours` | spring forward: 22.5 h real, not 23.5 |

- [ ] **Step 6: Run** `npx vitest run src/domain/time.test.ts` → all PASS, then `npx tsc --noEmit` → clean.
- [ ] **Step 7: Commit** `git add src/domain/time.ts src/domain/time.test.ts && git commit -m "feat: relative decide-by hint"`

### Task 2: Public page hint and confirmed-plan help line

**Covers:** AC3, AC4, AC5

**Files:**
- Modify: `src/web/views/public-plan-page.ts`, `src/web/routes/public.ts`
- Test: `src/web/views/public-plan-page.test.ts`, `src/web/routes/public.test.ts`

**Interfaces:**
- Consumes: `formatDeadlineHint(deadline, now)` from Task 1.
- Produces: `publicPlanPage({ plan, state, publicToken, now, notice?, form? })` — `now: Temporal.Instant` is a new required argument. Open plans render `Goes ahead with a minimum of ${minimum}. Decide by ${formatDeadline(...)} (${hint}).` The commit form's help line is `Only used to send you the details and reminders. Never shown to anyone.` when `state === 'on'`, else `Only used to tell you if it's on. Never shown to anyone.`

- [ ] **Step 1: Write the failing route test** in `public.test.ts`, `'the decide-by sentence ends with the relative hint (AC3)'`: publish with `publishPlan(deps, { deadlineDate: '2026-11-12', deadlineTime: '10:00' })` (deadline `2026-11-12T18:00:00Z`, gathering Sat 14 Nov 10:00 AM; minimum 3), app with `now: fixedClock('2026-11-10T18:00:00Z')`, GET `/p/<publicToken>`, `decodeEntities(body)` contains `Goes ahead with a minimum of 3. Decide by Thu 12 Nov, 10:00 AM (in 2 days).`
- [ ] **Step 2: Run** `npx vitest run src/web/routes/public.test.ts -t "relative hint"` → FAIL (sentence ends `10:00 AM.`).
- [ ] **Step 3: Implement** the `now` argument and the sentence in `publicPlanPage`; in `renderPlan` (`src/web/routes/public.ts`) pass the same `deps.now()` already used for `displayState`: read it once into a local and use it for both.
- [ ] **Step 4: Update the existing view tests** in `public-plan-page.test.ts` for the new required `now`: the `render` helper takes `now` defaulting to `Temporal.Instant.from('2026-11-10T18:00:00Z')`; the existing assertion `Decide by Wed 11 Nov, 10:00 PM.` becomes `Decide by Wed 11 Nov, 10:00 PM (tomorrow).` (worked by hand: the deadline `2026-11-12T06:00:00Z` is Wed 11 Nov 10:00 PM PST, 36 h after now, local dates 10 → 11 = 1 day)
- [ ] **Step 5: Run** the two files → PASS.
- [ ] **Step 6: Failing test for AC4** (route test, same plan, three `now` values via separate `createApp` instances, as `public.test.ts` already does with `fixedClock`): `2026-11-11T17:00:00Z` → `(tomorrow)`; `2026-11-12T13:00:00Z` → `(in 5 hours)`; `2026-11-12T17:30:00Z` → `(in under an hour)`. Passes once Step 3 is done, so show RED by temporarily mutating the hours branch in `formatDeadlineHint`, then restore.
- [ ] **Step 7: Failing test for AC5** in `public.test.ts`: publish the example plan, then `commit` twice with `commitFormSchema.parse` forms (Raj and Mia, as `confirmedPlan` in that file does; minimum 3 with Ann = 3 commits → confirmed). GET `/p/<publicToken>` with `now` `2026-11-10T18:00:00Z` → body contains exactly `Only used to send you the details and reminders. Never shown to anyone.` and not `Only used to tell you if it's on.` Also in the view test file: `render(plan({ state: 'confirmed' }), 'on')` shows the new line; `render(plan())` still shows the old line (update the existing assertion at `public-plan-page.test.ts:186` only if it breaks).
- [ ] **Step 8: Implement** the help-line switch in `commitForm` (add a `confirmed: boolean` parameter, true when `state === 'on'`).
- [ ] **Step 9: Review-Focus test:** a 422 re-render on the confirmed plan (POST `/p/<token>/commit` with an empty name via the file's `post` helper) contains the new help line.
- [ ] **Step 10: Run** `npx vitest run src/web` → PASS; `npx tsc --noEmit` → clean.
- [ ] **Step 11: Commit** `git add src/web && git commit -m "feat: decide-by hint and confirmed help line"`

### Task 3: Private link box when the manage-link email fails

**Covers:** AC1, AC2

**Files:**
- Modify: `src/web/views/published-page.ts`, `src/web/routes/manage.ts:71-76`
- Test: `src/web/views/published-page.test.ts`, `src/web/routes/manage.test.ts`, `src/web/routes/create.test.ts:119-135`

**Interfaces:**
- Produces: `PublishedLinks` gains `manageUrl: string` (absolute, `${config.baseUrl}/m/${plan.manageToken}`); `manageLink` stays the relative `/m/<token>` used for the emailed case's "Manage your plan" link. Markup for the second box, which Task 4 relies on: `<label for="manage-link">Your private link</label>`, then `<div class="linkbox">` holding `<input type="text" id="manage-link" readonly aria-label="Your private link" value="${manageUrl}">` and `<button type="button" id="copy-manage" class="btn btn-secondary" data-copy="manage-link">Copy</button>`. The first box's button becomes `<button type="button" id="copy" class="btn btn-primary" data-copy="public-link">Copy</button>`.
- Notice copy, exact: `We couldn't email you your private link. Copy it now and keep it somewhere safe: it's the only way to manage the plan.` — placed after the share box and `copy-status`, followed by the second box. In this case there is no "Manage your plan" link and no "Bookmark" text. The emailed case is unchanged (one box, `emailedCopy`, `<a class="quiet" href="/m/<token>">Manage your plan</a>`).

- [ ] **Step 1: Write the failing view test** in `published-page.test.ts`, `'failed email: private link box (AC1)'`: `render(false)` (the helper gains `manageUrl: 'https://example.test/m/secret'`) contains the notice above, `<label for="manage-link">Your private link</label>`, an input `id="manage-link"` with `value="https://example.test/m/secret"`, a button `id="copy-manage"` reading `Copy` with `btn btn-secondary`, and does not contain `Bookmark` or `Manage your plan`.
- [ ] **Step 2: Run** `npx vitest run src/web/views/published-page.test.ts` → FAIL.
- [ ] **Step 3: Implement** `publishedPage` per the Interfaces block. Replace `notEmailedCopy` with the new notice.
- [ ] **Step 4: Failing test for AC2** in the same file: `render(true)` has exactly one `class="linkbox"`, contains `We've emailed you a private link to manage the plan. Keep it to yourself.` and `<a class="quiet" href="https://example.test/m/secret">Manage your plan</a>`, and contains neither `id="manage-link"` nor `Your private link`. Update the other tests in the file that asserted the old failure sentence (`renders both emailed variants`) and the manage-link-as-quiet-link test (use `render(true)`, already the case).
- [ ] **Step 5: Wire the route** in `manage.ts` to pass `manageUrl`.
- [ ] **Step 6: Route tests.** In `manage.test.ts` the default `publishPlan` does not send the email, so `manageLinkSent` is false: update `'shows the share link and the manage link'` into the failed case: body contains the new notice, `value="https://calvin.test/m/${manageToken}"` and not `Bookmark`. Add the emailed case through `POST /plans` (as `create.test.ts`'s `post(deps)` helper does, with the fake email succeeding) then GET the `Location`: one `linkbox`, the emailed line, `href="/m/<token>"` Manage link. Update `create.test.ts:130-132` to expect the new notice instead of the Bookmark sentence.
- [ ] **Step 7: Run** `npx vitest run src/web` → PASS; `npx tsc --noEmit` → clean.
- [ ] **Step 8: Commit** `git add src/web && git commit -m "feat: private link box when the manage-link email fails"`

### Task 4: Copy script copies whichever box's button was pressed

**Covers:** AC1

**Files:**
- Modify: `public/create.js` (the "Published page: Copy and Share…" block, from `const link = byId('public-link')` to the end of the Copy handler)
- Test: `src/web/views/published-page.test.ts` (the markup contract the script reads)

**Interfaces:**
- Consumes: Task 3's markup: every Copy button has `data-copy="<id of its input>"`; `#public-link` stays the Share target; one shared `#copy-status` live region.

- [ ] **Step 1: Failing contract test** in `published-page.test.ts`: for `render(false)`, every `<button ... data-copy="X">` has a matching `<input ... id="X"` inside the same `linkbox`, and there are exactly two such buttons (`copy` → `public-link`, `copy-manage` → `manage-link`); for `render(true)` there is exactly one.
- [ ] **Step 2: Run** → FAIL if Task 3 left `data-copy` off; otherwise show RED by temporarily deleting the attribute from the view, then restore.
- [ ] **Step 3: Rewrite the Copy block** in `public/create.js`: `document.querySelectorAll('button[data-copy]')`; for each button, the input is `byId(button.dataset.copy)`; the click handler copies that input's value, selects it on failure or when `navigator.clipboard` is missing, flips only that button's text to `Copied` and back to `Copy` after 2000 ms (per-button restore timer), and writes `Copied` to `#copy-status` as today. Keep the Share block reading `#public-link`.
- [ ] **Step 4: Check by hand** (the script has no automated tests at poc; record the result in the PR description): `node --check public/create.js` passes; then run the app locally on `FACTORY_PORT_BASE + 0`, publish a plan with the email fake failing (or open `/m/<token>/published` for a plan whose `manageLinkSent` is false), and in a browser press each Copy and paste: the first pastes `BASE_URL/p/<publicToken>`, the second `BASE_URL/m/<manageToken>`, and only the pressed button reads `Copied`. If a browser is not available in this session, state that in the PR description; the operator's on-phone check after merge (story body) is the final check.
- [ ] **Step 5: Run** `npx vitest run` → all PASS; `npx tsc --noEmit` → clean.
- [ ] **Step 6: Commit** `git add public/create.js src/web/views/published-page.test.ts && git commit -m "feat: copy script serves every link box"`

## Rulings

Ruling: N = 1 hour reads "(in 1 hour)", not "(in 1 hours)" — the story's template is "(in N hours)" and the criteria pin only 5; singular is correct English — if wrong, one string in `formatDeadlineHint` changes.
Ruling: when 24 h or more have elapsed but the deadline falls on the same local calendar day (the 25-hour fall-back day), the hint is "(in 24 hours)" — the story's day rule would give "(in 0 days)" — if wrong, that one rare day reads in hours instead of days.
Ruling: the published page takes a new absolute `manageUrl` and keeps `manageLink` relative — the emailed case must stay "as before" and the new input must hold `BASE_URL/m/<manageToken>` — it costs one extra field on `PublishedLinks`.
Ruling: `publicPlanPage` takes `now` as an argument rather than reading a clock — views are pure and `deps.now` is the only clock — it costs updating the existing view tests' render helper.
Ruling: the story's by-hand phone check (story body) is not an acceptance criterion; Task 4 records a local browser check and leaves the phone check to the operator after merge.
