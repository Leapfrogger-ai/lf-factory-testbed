# Take back a commit from an emailed link (Story 2.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A committer opens `/w/<withdrawToken>`, sees a confirm page, and a POST withdraws them (count down, `commit.withdrawn` event, plan state untouched); committing again with the same email rejoins them.

**Architecture:** `commit()` in `src/domain/plans.ts` learns `rejoined` (clears `withdrawn_at`). A new `withdraw()` and `loadWithdrawTarget()` sit beside it. A pure view `src/web/views/withdraw-page.ts` renders the four states, and a new `src/web/routes/withdraw.ts` (R10, R11) is mounted in `createApp`. No signal is sent on withdraw.

**Tech Stack:** Node 26 + TypeScript (type stripping), Hono + `hono/html`, Drizzle on Postgres 17, Vitest 5.

**Spec:** .factory/story.md (story #175)

## Global Constraints

- Plan and commit state changes only in `src/domain/plans.ts`, inside a transaction that locks the plan row and appends its event through `appendEvent` — one source of truth, and commit races settle on the row lock. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- A Temporal signal or start failure after a committed transaction is logged at `error` and never fails the user's request — the commit already stands. ([ADR 0002](docs/adr/0002-postgres-owns-state-temporal-owns-time.md))
- Routes only parse and validate, call a `domain/` function, then render a view or redirect 303; views are pure functions with no I/O, and no page renders an email address — SQL and I/O stay in one module, and NFR006 holds by construction.
- Every external boundary (`db`, `now`, `suggestPlanCall`, `sendEmail`, `planWorkflows`) reaches code as an argument through `createApp(deps)` or `createActivities(deps)`, only `src/main.ts` builds the real ones, and no code outside it calls `Date.now()` or `new Date()` for the current time — tests can replace only what's passed in. ([test-strategy](specs/calvin-3/test-strategy.md))
- Times are stored as UTC `timestamptz`, and every local-time rule and display format goes through `src/domain/time.ts` with `PLAN_TIME_ZONE` — one place for DST and the UX §8.8 formats.
- Code, copy and names use `GLOSSARY.md`'s terms (`commit`, `withdraw`, `minimum`, `commit deadline`, `called off`), never their _Avoid_ words — the code, the specs and the UI mean the same thing.
- Errors follow the architecture's Error Handling section: any bad token is the same 404 page (a malformed one without a database query) — users never see a different error shape per route.
- Everything is logged through `src/log.ts`, by `planId`, and no log line holds an email address, a token, a secret, a form body or a query string — tokens are capabilities. ([ADR 0005](docs/adr/0005-capability-tokens-stored-in-plaintext.md))
- Use `hono/html`'s tagged template for server-side HTML; don't concatenate strings or add a template engine — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Drizzle's `db.transaction` and `.for('update')` for commit, confirm, call-off and deadline resolution; don't add application locks — [finding](specs/calvin/research/node-hono-drizzle.md).
- Use Hono's `app.request()` for route tests; don't add supertest or listen on a port — [finding](specs/calvin/research/node-hono-drizzle.md).
- Tests verify behaviour through public interfaces, at the seams `specs/calvin-3/test-strategy.md` names — tests that reach inside break on every refactor.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- An expected value comes from an independent source (a hand-worked literal, the PRD, the UX spec, api-specification.md), never recomputed the way the code does, so an expected instant is an ISO literal, not a `time.ts` call — otherwise the test can't fail.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- A test's setup goes through `tests/support/builders.ts` and `domain/plans.ts`, never raw inserts — setup that bypasses the domain tests states the app can't reach.
- No implementation-coupled tests. Test through the seam's interface. A route test checks the response and the recorded boundary calls, not the database. A Plan operations test reads state back through `domain/plans.ts` functions, not with its own SQL.
- Each route's outcome table in api-specification.md is that route's test list.
- `TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database.
- Form requests must set `Content-Type: application/x-www-form-urlencoded`, or the validator sees `{}`, and must set `Origin: <BASE_URL>` to pass CSRF.
- No page, URL or redirect ever contains an email address.
- No secret is read, stored, logged or committed other than as the architecture's Secrets table says (env vars from Fly secrets or a gitignored `.env`; never in `fly.toml`, the Dockerfile, the repo, a log line or a CI command line; `.env.example` holds names only) — a leaked secret can't be taken back.

Binding: CODING_STANDARDS.md, GLOSSARY.md, docs/adr/0002-postgres-owns-state-temporal-owns-time.md, docs/adr/0005-capability-tokens-stored-in-plaintext.md, specs/calvin-3/test-strategy.md, specs/calvin-3/api-specification.md, specs/calvin-3/architecture.md

## Review Focus

- A withdrawn committer who commits with the email in a different case (`MIA@Example.test`) must rejoin, not create a second commit. Pinned in Task 2.
- Two simultaneous withdraw POSTs of one token must write one `commit.withdrawn` event and lower the count once. Pinned in Task 1.
- A rejoin when the plan is still open and the rejoin reaches the minimum must confirm the plan once (`plan.confirmed`), not signal `committed`. Pinned in Task 2.
- A scanner's repeated GETs, or a GET after withdrawal, must never write anything or flip the page to done without a withdrawal in the database. Pinned in Task 4.
- A called-off plan's withdraw link must not 500 or show a button: it shows the "isn't going ahead" text, and a POST writes nothing and redirects to the page. Pinned in Tasks 1, 3 and 4.

---

## Rulings

Ruling: `commit()` finds out whether the existing commit was withdrawn with a `select` of `withdrawn_at` for `(plan_id, email_normalized)` inside the row-locked transaction, before the upsert, and the upsert's `set` also clears `withdrawnAt` — `RETURNING` only shows the new values, and the row lock makes select-then-upsert race-free — if wrong, one extra query per commit.
Ruling: `withdraw()` and `loadWithdrawTarget()` return a view model of exactly what the page needs (no email, no names) — pages never render email, and routes shouldn't see rows — if wrong, a type moves.
Ruling: The rejoin signal needs no route change: story 2.2's route already signals `committed` for `planConfirmed && change !== 'repeat'` and picks notice `on`/`in` the same way; Task 4 only proves it through the route — if wrong, one condition in `public.ts`.
Ruling: The withdraw page's `called_off` text ("This one isn't going ahead, so there's nothing to withdraw from.") comes from api-specification R10 — the story names only the "already started" text — if wrong, only copy changes.
Ruling: Condition order on the page follows R10's table: `called_off`, then started, then withdrawn, then confirm. A withdrawn committer on a plan that has since started therefore sees "This one has already started." — if wrong, a one-line reorder.
Ruling: `src/web/views/withdraw-page.ts` is a new file, not an extension of `public-plan-page.ts`, because the two pages share nothing but `capitalise` (imported) — if wrong, a file merge.

---

### Task 1: `withdraw()` and `loadWithdrawTarget()`

**Covers:** AC2, AC3, AC4, AC7, AC8

**Files:**
- Modify: `src/domain/plans.ts`
- Test: `src/domain/plans.test.ts`

**Interfaces:**
- Consumes: `appendEvent`, `newToken`, existing helpers; `commits.withdrawToken`, `commits.withdrawnAt`, `commits.isCreator`.
- Produces:
  ```ts
  export type WithdrawTarget = {
    state: string;            // plan state: 'open' | 'confirmed' | 'called_off'
    format: string;
    venue: string;
    gatheringAt: Temporal.Instant;
    withdrawn: boolean;       // commit.withdrawn_at is set
  };
  export function loadWithdrawTarget(db: Db, withdrawToken: string): Promise<WithdrawTarget | null>; // null: no such commit, or the creator's
  export type WithdrawResult =
    | { outcome: 'not_found' }                       // unknown token or the creator's
    | { outcome: 'unavailable' }                     // plan called_off, or now >= gathering: nothing written
    | { outcome: 'already_withdrawn' }               // nothing written
    | { outcome: 'withdrawn'; planId: string; activeCount: number };
  export function withdraw(deps: Pick<AppDeps, 'db' | 'now'>, withdrawToken: string): Promise<WithdrawResult>;
  ```

- [ ] **Step 1: Write the failing test** `withdraw lowers the count and records commit.withdrawn with the new count` in `plans.test.ts` (example plan with minimum 4 so it stays open; Ana publishes and Mia commits, so Mia's token is the only non-creator `withdrawToken` in `loadPlan(...).commits`): result `{ outcome: 'withdrawn', activeCount: 1, planId }`; `loadPlan(...).count` is 1; the last event is `{ type: 'commit.withdrawn', data: { activeCount: 1 } }`; `state` is still `open`.
- [ ] **Step 2: Run** `npx vitest run src/domain/plans.test.ts -t "withdraw"` — Expected: FAIL (`withdraw` is not exported).
- [ ] **Step 3: Implement** `withdraw` in `src/domain/plans.ts`: one transaction; look up the commit by `withdrawToken` joined to its plan, then lock the plan row (`.for('update')`) and re-read the commit's `withdrawnAt` under the lock; creator or no match → `not_found`; `called_off` or now ≥ gathering → `unavailable`; already withdrawn → `already_withdrawn`; else set `withdrawnAt` to `now`, count active commits, `appendEvent` `commit.withdrawn` (with `commitId`). Never touch `plans.state`. Implement `loadWithdrawTarget` with one joined select.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Next tests, one at a time (AC3, AC4, AC7, AC8, Review Focus)**, each RED then GREEN, mutation-checked if first-run green:
  - `withdrawing from a confirmed plan at exactly its minimum leaves it confirmed` (minimum 3, Ana, Raj, Mia → confirmed; Mia withdraws: `outcome: 'withdrawn'`, `activeCount: 2`, `state` `'confirmed'`, no second `plan.confirmed`, no `plan.called_off`). Mutation: make `withdraw` set state to `open` when below the minimum.
  - `a second withdraw writes nothing` (`already_withdrawn`; event count and `count` unchanged).
  - `the creator's token is not found` (Ana's `withdrawToken` → `not_found` from both `withdraw` and `loadWithdrawTarget`; she is still active).
  - `an unknown token is not found` (a valid-shaped `newToken()` → `not_found`).
  - `withdraw after the gathering started is unavailable and writes nothing` (`now` `2026-11-14T18:00:00Z`; `count` unchanged, no `commit.withdrawn` event) and `withdraw on a called-off plan is unavailable` — build the called-off plan only through `domain/plans.ts` if a call-off function exists; if none does, skip this test, cover `called_off` in Task 3's view test only, and record a `Ruling:` that call-off isn't built yet.
  - `two simultaneous withdraws of one token write one event` (`Promise.all` of two `withdraw` calls: exactly one `withdrawn`, one `already_withdrawn`; one `commit.withdrawn` event; `count` lowered once). If green first time, remove `.for('update')` to see it fail, then restore.
  - `loadWithdrawTarget returns the plan's format, venue and gathering instant and whether the commit is withdrawn` (`gatheringAt` equals `Temporal.Instant.from('2026-11-14T18:00:00Z')`, `withdrawn` false before and true after).
- [ ] **Step 6: Run** `npx tsc --noEmit && npx vitest run src/domain` — Expected: PASS. Commit — `git add src/domain && git commit -m "feat: withdraw() and loadWithdrawTarget()"`

### Task 2: `commit()` rejoins a withdrawn committer

**Covers:** AC5, AC6

**Files:**
- Modify: `src/domain/plans.ts`
- Test: `src/domain/plans.test.ts`

**Interfaces:**
- Consumes: existing `commit(deps, publicToken, form)`, `loadPlan` (`count`, `state`, `events`, `commits[].withdrawToken`), `publishPlan`, `testDeps`, `fixedClock`, and `withdraw()` from Task 1 (setup for a withdrawn committer goes through it).
- Produces: `CommitResult.committed.change: 'new' | 'repeat' | 'rejoined'` (widened). A rejoin clears `withdrawn_at`, counts as active, and appends `commit.added` with `change: 'rejoined'` and the new `activeCount`.

- [ ] **Step 1: Write the failing test** `a withdrawn committer who commits again is active with change rejoined` in `plans.test.ts` (example plan, minimum 3; Ana, Raj, Mia in so the plan is confirmed; Mia `withdraw`s via her token from `loadPlan(...).commits`; then `commit` as `mia@example.test`): result `outcome: 'committed'`, `change: 'rejoined'`, `confirmed: false`, `planConfirmed: true`; `loadPlan(...).count` is 3 again; the last event is `{ type: 'commit.added', data: { change: 'rejoined', isCreator: false, activeCount: 3 } }`; the commit's `withdrawToken` is unchanged (her old link works again).
- [ ] **Step 2: Run** `npx vitest run src/domain/plans.test.ts -t "rejoined"` — Expected: FAIL (`change` is `repeat`, count stays 2).
- [ ] **Step 3: Implement** in `commit()`: before the upsert, select `withdrawnAt` of the commit with this `planId` and `emailNormalized`; `change` is `'new'` when inserted, `'rejoined'` when that earlier `withdrawnAt` was not null, else `'repeat'`. Add `withdrawnAt: null` to the upsert's `set`. Widen `CommitResult`'s `change`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Next test, then code** — `a rejoin with the email in another case is the same commit` (Mia withdrew; commit as `MIA@Example.test`: `change: 'rejoined'`, `count` back up by one, `commits` still has one entry for her — total commits length unchanged). Review Focus.
- [ ] **Step 6: Next test** — `a rejoin that reaches the minimum on an open plan confirms it` (minimum 4; Ana, Raj, Mia in (3, open); Mia withdraws (2); Sam commits (3, open); Mia rejoins: `confirmed: true`, `planConfirmed: true`, exactly one `plan.confirmed` event, last two events `commit.added` (`rejoined`, `activeCount: 4`) then `plan.confirmed`). If it passes first time, mutate the `change` mapping to see it fail, then restore.
- [ ] **Step 7: Next test** — `a repeat commit by an active committer is still repeat` (existing behaviour; Mia commits twice with no withdraw: `repeat`, count unchanged). If it passes first time, mutate `withdrawnAt` handling (treat every conflict as `rejoined`) to see it fail, then restore.
- [ ] **Step 8: Run** `npx tsc --noEmit && npx vitest run src/domain` — Expected: PASS. Commit — `git add src/domain && git commit -m "feat: commit() rejoins a withdrawn committer"`

### Task 3: The withdraw page view

**Covers:** AC1, AC2, AC8

**Files:**
- Create: `src/web/views/withdraw-page.ts`
- Test: `src/web/views/withdraw-page.test.ts`

**Interfaces:**
- Consumes: `WithdrawTarget` (Task 1), `formatDay` from `src/domain/time.ts`, `capitalise` from `public-plan-page.ts`, `html` from `hono/html`.
- Produces: `export function withdrawPage(args: { target: WithdrawTarget; token: string; now: Temporal.Instant }): HtmlEscapedString`. The view is chosen only from `target` and `now`, never from `done`. Per R10 in this order: `state === 'called_off'` → "This one isn't going ahead, so there's nothing to withdraw from." (no button); `now >= target.gatheringAt` → "This one has already started." (no button); `target.withdrawn` → "You're out. You've withdrawn from ${capitalise(format)} on ${formatDay(gatheringAt)}. No more emails about it."; otherwise `Withdraw from ${capitalise(format)} at ${venue} on ${formatDay(gatheringAt)}?` and `<form method="post" action="/w/${token}">` with one `<button>` **Withdraw**, no other fields. The page is wrapped by the route in `layout(..., { noindex: true })`.

- [ ] **Step 1: Write the failing test** `the confirm view asks "Withdraw from Coffee at Blue Bottle on Sat 14 Nov?" with a Withdraw button` in `withdraw-page.test.ts` (target `{ state: 'confirmed', format: 'coffee', venue: 'Blue Bottle', gatheringAt: Temporal.Instant.from('2026-11-14T18:00:00Z'), withdrawn: false }`, now `2026-11-10T00:00:00Z`): the text contains that exact question, `method="post"`, `action="/w/${token}"`, and `Withdraw</button>`; it contains no `<input`.
- [ ] **Step 2: Run** `npx vitest run src/web/views/withdraw-page.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `withdrawPage` as above. Run the same command — Expected: PASS.
- [ ] **Step 4: One view test at a time, RED then GREEN:** `the done view reads "You're out. You've withdrawn from Coffee on Sat 14 Nov. No more emails about it." and has no button` (`withdrawn: true`; note `You're` is escaped as `You&#39;re` by `html` — assert on the decoded text the way `public-plan-page.test.ts` does); `a started plan reads "This one has already started." with no button` (`now` `2026-11-14T18:00:00Z`; no `<form`); `the started view wins over withdrawn` (`withdrawn: true` and started → the "already started" text); `a called-off plan reads "This one isn't going ahead, so there's nothing to withdraw from." with no button` (Review Focus); `venue and format are escaped` (`venue: '<b>Blue</b>'` appears escaped).
- [ ] **Step 5: Run** `npx tsc --noEmit && npx vitest run src/web/views` — Expected: PASS. Commit — `git add src/web/views && git commit -m "feat: withdraw page view"`

### Task 4: R10 and R11 through the route

**Covers:** AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9

**Files:**
- Create: `src/web/routes/withdraw.ts`, `src/web/routes/withdraw.test.ts`
- Modify: `src/web/app.ts` (mount `withdrawRoutes(deps)` beside the others)

**Interfaces:**
- Consumes: `loadWithdrawTarget`, `withdraw` (Task 1), `withdrawPage` (Task 3), `isToken`, `layout`, `notFoundPage`, `commit` and `fakePlanWorkflows().signalCalls`.
- Produces: `export function withdrawRoutes(deps: AppDeps): Hono` serving `GET /w/:token` and `POST /w/:token`.

Route behaviour:
1. Both methods: a malformed token (`!isToken`) → the not-found page, 404, before any database access.
2. `GET`: `loadWithdrawTarget`; `null` → 404 not-found page; else 200 `layout(title, withdrawPage({ target, token, now: deps.now() }), { noindex: true })`. The title is generic ("Withdraw"); `done` is ignored. No writes.
3. `POST`: `withdraw(deps, token)`; `not_found` → 404; `unavailable` → 303 `/w/${token}`; `already_withdrawn` and `withdrawn` → 303 `/w/${token}?done=1`. No signal, no log of the token.

Tests (page helper: publish the example plan, minimum 4, with Ana the creator and Mia committing through `commit()`; Mia's token is read from `loadPlan(...).commits`; POSTs carry `Origin: TEST_BASE_URL`, `Content-Type: application/x-www-form-urlencoded`; each test is RED then GREEN, first green run mutation-checked):
- [ ] **Step 1: AC1** `GET shows the confirm page, is noindex and changes nothing` — 200; decoded body contains "Withdraw from Coffee at Blue Bottle on Sat 14 Nov?" and `>Withdraw</button>`; `<meta name="robots" content="noindex"` present; GET twice, then `loadPlan(...).count` is still 2 and `events` has no `commit.withdrawn`. Run `npx vitest run src/web/routes/withdraw.test.ts` — Expected: FAIL (404), then implement `withdrawRoutes`, mount it in `app.ts`, then PASS.
- [ ] **Step 2: AC2** `POST withdraws, redirects to done and the page reads you're out` — 303, `location` exactly `/w/${token}?done=1`; GET `?done=1` contains "You're out. You've withdrawn from Coffee on Sat 14 Nov. No more emails about it." and no `<form`; `count` is 1; the last event is `{ type: 'commit.withdrawn', data: { activeCount: 1 } }`; `signalCalls` has no entry beyond the `start` the publish made (empty).
- [ ] **Step 3: AC3** `withdrawing from a confirmed plan at its minimum keeps it confirmed` — minimum 3, Raj and Mia in (confirmed); Mia POSTs: 303 `?done=1`; `state` `'confirmed'` through `loadPlan`; `signalCalls` has only the `confirmed` signal that the confirming commit sent.
- [ ] **Step 4: AC4** `a second POST writes nothing and redirects to done` — POST twice: both 303 to `?done=1`; `events` has exactly one `commit.withdrawn`; `count` lowered once.
- [ ] **Step 5: AC5** `committing again after withdrawing makes the commit active and the withdraw page shows confirm` — Mia withdraws, then POSTs `/p/<publicToken>/commit` as `mia@example.test`: 303 `notice=in&n=Mia`; `count` back to 2; last event `commit.added` with `change: 'rejoined'`; GET `/w/${token}` (no `done`) contains "Withdraw from Coffee at Blue Bottle on Sat 14 Nov?" and the button; GET `/w/${token}?done=1` also shows confirm, not "You're out".
- [ ] **Step 6: AC6** `a rejoin on a confirmed plan signals committed with her commit id` — minimum 3, Raj and Mia confirm the plan; Mia withdraws; Mia commits again: 303 `notice=on&n=Mia`; `signalCalls` ends with `{ planId, signal: 'committed', arg: <string> }` after the single `confirmed` one; a second rejoin by Raj yields a different `arg`.
- [ ] **Step 7: AC7** `the creator's token is 404 for GET and POST` — Ana's token from `loadPlan(...).commits` (`isCreator: true`): GET and POST both 404 with the not-found page body (same body as an unknown valid-shaped token); `count` unchanged.
- [ ] **Step 8: AC8** `a started plan reads already started with no button and a POST writes nothing` — apps with `now` `2026-11-14T18:00:00Z` on the same database: GET contains "This one has already started." and no `<form`; POST: 303 `location` `/w/${token}` and `count` unchanged, no `commit.withdrawn` event.
- [ ] **Step 9: AC9** `a malformed token is 404 without a database query` — copy the technique from `public.test.ts`'s "bad tokens are 404 without a database query" (a `db` whose every use throws); `GET /w/not-a-token` and `POST /w/not-a-token` both 404.
- [ ] **Step 10: Review Focus** `a called-off plan's withdraw link shows the isn't going ahead text and POST writes nothing` — only if a call-off exists in `domain/plans.ts` (see Task 1 Step 5); otherwise skip and rely on Task 3's view test.
- [ ] **Step 11: Run** `npx tsc --noEmit && npx vitest run` — Expected: all PASS, including every earlier test. Commit — `git add src && git commit -m "feat: withdraw page and withdraw POST (R10, R11)"`
