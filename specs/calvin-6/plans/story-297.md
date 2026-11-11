# Story 5.4 (#297): Withdrawing, with a way back — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The withdraw confirmation page explains what withdrawing does and offers a quiet "Stay in" link back to the plan's public page.

**Architecture:** `WithdrawTarget` gains `publicToken` (the loader already joins `plans`). `withdrawPage`'s confirm view adds one sentence (two variants by plan state) and wraps the Withdraw button and a "Stay in" link in a `.stack`. The route is unchanged.

**Tech Stack:** Node 26 TypeScript (type stripping), Hono `html`, Drizzle, Vitest 5.

**Spec:** .factory/story.md (story #297)

## Global Constraints

- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine
- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string
- Tests verify behaviour through public interfaces, at the seams `specs/calvin/test-strategy.md` names
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call
- One test, then its implementation
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts
- Vitest 5 runs every test. calvin has no build step, so the build command is the type check. (`npx tsc --noEmit`, `npx vitest run`)
- App port (manual dev runs only; tests use `app.request()`) | `FACTORY_PORT_BASE + 0` (default 8080)
- Test database | `FACTORY_DB_NAME` on that server (default `calvin_test`)
- calvin's public, manage, withdraw and check-in tokens are 256-bit random strings (`randomBytes(32).toString('base64url')`), stored as plaintext `TEXT UNIQUE` columns on `plans` and `commits` and looked up by equality.

Binding: CODING_STANDARDS.md, GLOSSARY.md, test-strategy.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md

## Review Focus

- An open plan versus a confirmed plan: only the confirmed one says "It stays on for everyone else." Pinned in Tasks 2 and 3.
- The other withdraw views (done, already started, called off) must not gain the sentence, the button or the "Stay in" link, and must stay free of names, emails and `noindex`-less markup. Pinned in Tasks 2 and 3.
- "Stay in" is a plain GET link: following it changes nothing (count and events unchanged). Pinned in Task 3.
- A venue or format containing HTML still escapes on the confirm view with the new markup. Existing test stays green; Task 2.

---

### Task 1: The withdraw target carries the public token

**Covers:** AC1

**Files:**
- Modify: `src/domain/plans.ts` (`WithdrawTarget`, `loadWithdrawTarget`), `src/web/views/brand.test.ts` and `src/web/views/withdraw-page.test.ts` (the `target()` builders gain `publicToken: 'ptok123'`)
- Test: `src/domain/plans.test.ts` (`describe('loadWithdrawTarget')`)

**Interfaces:**
- Produces: `WithdrawTarget` gains `publicToken: string` (the plan's `plans.publicToken`). Task 2 reads it.

- [ ] **Step 1: Update the existing test** `"returns the plan's format, venue and gathering instant…"` so its `toEqual` also expects `publicToken` (the `publicToken` already destructured from `publishPlan` in that test).
- [ ] **Step 2: Run** `npx vitest run src/domain/plans.test.ts -t loadWithdrawTarget` → FAIL (object lacks `publicToken`).
- [ ] **Step 3: Implement:** add `publicToken: string` to `WithdrawTarget`, select `plans.publicToken` in `loadWithdrawTarget` and return it. Add `publicToken: 'ptok123'` to the two view-test `target()` builders so `npx tsc --noEmit` is clean.
- [ ] **Step 4: Run** `npx vitest run src/domain/plans.test.ts src/web/views && npx tsc --noEmit` → PASS, clean.
- [ ] **Step 5: Commit** `git add src/domain/plans.ts src/domain/plans.test.ts src/web/views/brand.test.ts src/web/views/withdraw-page.test.ts && git commit -m "feat: withdraw target carries the public token"`

### Task 2: Confirm view sentence and "Stay in" link

**Covers:** AC1, AC2, AC4

**Files:**
- Modify: `src/web/views/withdraw-page.ts`
- Test: `src/web/views/withdraw-page.test.ts`

**Interfaces:**
- Consumes: `WithdrawTarget.publicToken` from Task 1.
- Produces: the confirm view (not withdrawn, not started, not called off) renders, in order: the `h1` (unchanged), `<p class="copy">SENTENCE</p>`, then `<div class="stack">` holding the existing `<form>` with the Withdraw button and `<a class="quiet" href="/p/${target.publicToken}">Stay in</a>`. SENTENCE is `It stays on for everyone else. You'll come off the list, and we won't email you about it again.` when `target.state === 'confirmed'`, else `You'll come off the list, and we won't email you about it again.`

- [ ] **Step 1: Write the failing tests** in `withdraw-page.test.ts` (render helper already un-escapes `'`):
  - `'an open plan says only that you will come off the list (AC1)'`: `render(target({ state: 'open' }))` contains `You'll come off the list, and we won't email you about it again.`, does not contain `It stays on for everyone else.`, matches `/<h1>[^<]*<\/h1>\s*<p[^>]*>You'll come off/`, contains `<a class="quiet" href="/p/ptok123">Stay in</a>`, and matches `/<div class="stack">[\s\S]*<form[\s\S]*Withdraw<\/button>[\s\S]*Stay in<\/a>[\s\S]*<\/div>/`.
  - `'a confirmed plan adds "It stays on for everyone else." (AC2)'`: `render(target({ state: 'confirmed' }))` contains `It stays on for everyone else. You'll come off the list, and we won't email you about it again.`
  - `'the done, started and called-off views have no sentence and no Stay in link (AC1)'`: for `target({ withdrawn: true })`, `render(target(), atStart)` and `target({ state: 'called_off' })`: body contains neither `Stay in` nor `come off the list`.
- [ ] **Step 2: Run** `npx vitest run src/web/views/withdraw-page.test.ts` → the first two FAIL.
- [ ] **Step 3: Implement** the change in the confirm branch of `withdrawPage` in `src/web/views/withdraw-page.ts` as specified under Produces; leave the other three branches as they are.
- [ ] **Step 4: Run** the file plus `npx vitest run src/web/views/brand.test.ts` → PASS (existing tests, including the button-class and escaping tests, stay green).
- [ ] **Step 5: Commit** `git add src/web/views/withdraw-page.ts src/web/views/withdraw-page.test.ts && git commit -m "feat: withdraw page explains and offers Stay in"`

### Task 3: Route-level proof, including "Stay in" and privacy

**Covers:** AC1, AC2, AC3, AC4

**Files:**
- Test: `src/web/routes/withdraw.test.ts` (no production change expected; if a test is RED, fix the view or loader from Tasks 1–2)

**Interfaces:**
- Consumes: the file's `pageWith(minimum, extra)` helper (returns `{ deps, app, published, miaToken }`; creator Ana Ruiz, last committer Mia Chen), `decodeEntities`, `CONFIRM_HEADING`, `postWithdraw`, `loadPlan`.

Fixture numbers, worked: `pageWith('3')` is Ana + Mia = count 2 against minimum 3, so it needs 1 more and the plan is open (AC1). `pageWith('3', [Raj])` is Ana + Raj + Mia = 3 = minimum, so it is confirmed (the same fixture the file's AC3/AC6 tests already pin). Mia's token stands in for the story's Raj: the token's owner is a label, the page must not show a name. The gathering is `2026-11-14T18:00:00Z` (Sat 14 Nov), as `CONFIRM_HEADING` already pins.

- [ ] **Step 1: Write failing test** `'an open plan needing 1 more shows the heading, the sentence, Withdraw and Stay in (AC1)'`: `pageWith('3')`, GET `/w/${miaToken}`, decoded body contains `CONFIRM_HEADING`, `You'll come off the list, and we won't email you about it again.`, `>Withdraw</button>` and `<a class="quiet" href="/p/${published.publicToken}">Stay in</a>`, and does not contain `It stays on for everyone else.`
- [ ] **Step 2: Run** `npx vitest run src/web/routes/withdraw.test.ts -t "AC1"` → expected GREEN if Tasks 1–2 are done; to show the test can fail, temporarily change the `href` in the view to `/p/x`, see RED, then restore.
- [ ] **Step 3: Write** `'a confirmed plan reads "It stays on for everyone else." first (AC2)'`: `pageWith('3', [{ name: 'Raj Rao', email: 'raj@example.test' }])`, GET `/w/${miaToken}`, decoded body contains `It stays on for everyone else. You'll come off the list, and we won't email you about it again.` Show RED by temporarily making the view test `state === 'open'`.
- [ ] **Step 4: Write** `'following Stay in leaves him in and the count unchanged (AC3)'`: `pageWith('3')`, GET the withdraw page, extract the `/p/<token>` href from the body, GET it (status 200), then `loadPlan(deps.db, published.manageToken)` has `count` 2 and no `commit.withdrawn` event.
- [ ] **Step 5: Write** `'every withdraw page has no email, no committer name and carries noindex (AC4)'`: build one plan with `pageWith('3', [Raj])`; collect bodies for GET `/w/${miaToken}` (confirm), GET `/w/${miaToken}?done=1` after `postWithdraw` (done), a `createApp({ ...deps, now: fixedClock('2026-11-14T18:00:00Z') })` GET for Raj's token on a second fresh plan (started), and a called-off view (call the plan off through `callOff` from `domain/plans.ts` on a third fresh plan, then GET its Mia token). Each decoded body: does not match `/@/`, does not contain `Ana`, `Mia`, `Raj`, and contains `<meta name="robots" content="noindex"`. (Look up `callOff`'s signature in `src/domain/plans.ts` and an existing call in `plans.test.ts`; the confirm and done views share one plan, so withdraw only after capturing the confirm body.)
- [ ] **Step 6: Run** `npx vitest run src/web/routes/withdraw.test.ts` → PASS, then full `npx vitest run` and `npx tsc --noEmit` → all green.
- [ ] **Step 7: Commit** `git add src/web/routes/withdraw.test.ts && git commit -m "test: withdraw page copy, Stay in and privacy"`

## Rulings

Ruling: Mia's withdraw token (the existing `pageWith` helper's last committer) stands in for the story's Raj — the tests assert page content, not whose token it is — if wrong it costs a rename of a fixture name only.
Ruling: "A plan that's on" is `state === 'confirmed'`; `open` gets the shorter sentence — matches GLOSSARY's "confirmed" and the story's "otherwise" — if wrong, one condition in the view.
Ruling: the sentence is a `<p class="copy">`, as the done view's paragraph — the story fixes no class — if wrong, one class name.
