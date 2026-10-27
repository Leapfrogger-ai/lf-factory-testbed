# calvin HTTP Route Specification

**Version**: 1.0
**Last Updated**: 2026-10-27
**Maturity**: poc
**Status**: Review
**Inputs**: [PRD.md](./PRD.md), [ux-spec.md](./ux-spec.md), [architecture.md](./architecture.md), [database-schema.md](./database-schema.md), [GLOSSARY.md](../../GLOSSARY.md), ADRs [0002](../../docs/adr/0002-postgres-owns-state-temporal-owns-time.md), [0005](../../docs/adr/0005-capability-tokens-stored-in-plaintext.md)

calvin has **no JSON API** (architecture, Code Organization). Its whole HTTP surface is the server-rendered HTML routes below: plain HTML forms that POST, then a 303 redirect to a GET. This document is their contract: form fields, validation, the status, page or redirect for every outcome, query parameters, and headers. Copy is from UX §6–8; the words are from the glossary.

---

## 1. Overview

### Route table

| # | Method | Path | Purpose | Success | Rate limited |
|---|--------|------|---------|---------|--------------|
| R1 | GET | `/` | Create page (inputs, suggestion card or fallback) | 200 HTML | — |
| R2 | POST | `/suggest` | Ask for a suggestion | 303 → `/?suggestion=<id>` | Yes |
| R3 | POST | `/plans` | Publish a plan | 303 → `/m/<manageToken>/published` | Yes |
| R4 | GET | `/m/:token/published` | Published screen | 200 HTML | — |
| R5 | GET | `/p/:token` | Public plan page (with OG tags) | 200 HTML | — |
| R6 | POST | `/p/:token/commit` | Commit | 303 → `/p/:token?notice=…` | — |
| R7 | GET | `/m/:token` | Manage page | 200 HTML | — |
| R8 | POST | `/m/:token/call-off` | Call the plan off | 303 → `/m/:token` | — |
| R9 | GET | `/m/:token/new` | Create page pre-filled from the plan (FR025) | 200 HTML | — |
| R10 | GET | `/w/:token` | Withdraw confirmation, or done | 200 HTML | — |
| R11 | POST | `/w/:token` | Withdraw | 303 → `/w/:token?done=1` | — |
| R12 | GET | `/c/:token/:question/:answer` | Record a check-in answer | 200 HTML | — |
| R13 | GET | `/healthz` | Fly health check | 200 `ok` | — |
| R14 | GET | `/static/:file` | `app.css`, `create.js`, `og.png` | 200 file | — |

Anything else gets the not-found page (§3.3). That includes a wrong method on a known path, such as `GET /plans`.

### Base URL

| Environment | Base URL |
|-------------|----------|
| Production | `BASE_URL` = `https://<calvin domain>` (the operator picks the domain) |
| Development | `http://localhost:8080` |

There's no `/api` prefix and no versioning. The pages and links are the product, and emailed links must keep working for a plan's whole life. So **paths in R1–R12 never change once the trial starts**.

### Links built by calvin

Every absolute link (emails, link box, share text) is `BASE_URL` + one of:

| Link | Path | Who gets it |
|------|------|-------------|
| Public link | `/p/<publicToken>` | Published screen, manage page, manage-link email, all committer emails |
| Manage link | `/m/<manageToken>` | Published screen ("Manage your plan"), manage-link email, creator's copies of the lifecycle emails |
| Withdraw link | `/w/<withdrawToken>` | Footer of every email to a committer other than the creator (FR016) |
| Check-in links | `/c/<checkInToken>/happened/yes`, `…/happened/no`, `…/attended/yes`, `…/attended/no` | Check-in email (creator only) |
| New plan link | `/m/<manageToken>/new` | Manage page action |

### Conventions

| Element | Convention |
|---------|------------|
| Request body | `application/x-www-form-urlencoded` (what `<form method="post">` sends). `multipart/form-data` is also parsed (`c.req.parseBody()`); no file fields exist |
| Field names | camelCase, the same as the zod schema keys in `src/web/forms.ts` |
| Text fields | Trimmed before validation; an all-whitespace value counts as empty |
| Dates in forms | `<input type="date">` → `YYYY-MM-DD`; `<input type="time">` → `HH:MM` (24h). Read as wall-clock time in `America/Los_Angeles` with `disambiguation: "compatible"` (architecture, Date/Time) |
| Responses | `text/html; charset=utf-8`, except `/healthz` (`text/plain`) and `/static/*` |
| Redirects | Always **303** after a POST (`c.redirect(url, 303)`), so back and refresh never resubmit (UX §8.5) |
| Path tokens | `:token` must match `^[A-Za-z0-9_-]{43}$`. Anything else is a 404 **without a database query** |
| Instants | Stored as UTC; shown only through `src/domain/time.ts` formats (UX §8.8) |

---

## 2. Access model

### Capability links, no accounts

There are no accounts, sessions or cookies. Possessing a link is the authorization. Tokens are 256-bit (`randomBytes(32).toString('base64url')`, NFR005), are stored in plaintext ([ADR 0005](../../docs/adr/0005-capability-tokens-stored-in-plaintext.md)), and are looked up by equality on a unique index.

| Capability | Token | Grants | Routes |
|------------|-------|--------|--------|
| Anyone | — | Create a plan | R1, R2, R3 (no `fromManageToken`), R13, R14 |
| Public link | `plans.public_token` | See the plan, commit | R5, R6 |
| Manage link | `plans.manage_token` | See full names, call off, start a new plan from it, see the published screen | R4, R7, R8, R9, R3 (with `fromManageToken`) |
| Withdraw link | `commits.withdraw_token` | Withdraw that one commit | R10, R11 |
| Check-in link | `plans.check_in_token` | Answer the two check-in questions | R12 |

**One not-found for every miss.** An unknown token, a malformed token, the creator's withdraw token, or a check-in link for a plan that isn't confirmed all render the same not-found page with 404 (UX §8.6). Nothing reveals which tokens exist or what kind they are.

### Privacy rules (NFR006)

- No page, URL or redirect ever contains an email address. The only exception is the creator's own email, pre-filled in R9's form. R9 is reached only through the manage link.
- Public pages show each committer's **first name**: the first word of `commits.name`, at most 16 chars, HTML-escaped. Full names appear only on the manage page (R7).
- `planId`, `commitId` and other internal UUIDs never appear in a URL or page. The one exception is `suggestions.id` (§R1, §R2): a suggestion holds only a city, the creator's rough area and time, and the proposal, and its UUID is not guessable.

### CSRF

`hono/csrf` with `origin: BASE_URL` on every POST. A request passes if `Origin` equals `BASE_URL` **or** `Sec-Fetch-Site` is `same-origin`. Otherwise it gets the system-error page with **403**, with the copy "Something went wrong. Go back and try again." No hidden form tokens.

### Response headers (every HTML response)

| Header | Value | Why |
|--------|-------|-----|
| `Referrer-Policy` | `no-referrer` | Tokens never leak to venue or map links (architecture, Security) |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'nonce-<n>'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` | `create.js` is the only script, served from `/static`. The nonce is there for any inline bootstrap |
| `X-Content-Type-Options`, `Strict-Transport-Security`, `X-Frame-Options`, COOP/CORP | `hono/secure-headers` defaults | |
| `Cache-Control` | `no-store` | Every page shows live state, and token pages must not sit in shared caches |
| `X-Robots-Tag` | `noindex` on every route **except** `GET /` | Operator decision: plan pages show first names, venue and date. The page also carries `<meta name="robots" content="noindex">`. Chat link previews still read the OG tags |

`/static/*` instead sends `Cache-Control: public, max-age=86400`.

---

## 3. Errors

The routes return HTML pages, not error objects. Every error is either an inline field error on the same page, or one of the shared pages below. A stack trace never reaches a page.

### 3.1 Status codes

| Status | When | What's rendered |
|--------|------|-----------------|
| 200 | GET page rendered | The page |
| 303 | Every successful (or no-op) POST | Redirect, empty body |
| 403 | CSRF check failed | System-error page (§3.3) |
| 404 | Unknown path, wrong method, unknown or malformed token, ineligible token (§2) | Not-found page (§3.3) |
| 413 | POST body over 16 KB (`hono/body-limit`) | System-error page |
| 422 | Form validation failed | **The same page re-rendered**, with every entered value kept and inline errors (UX §8.2) |
| 429 | Rate limit hit (§4) | The same page re-rendered with a notice, and `Retry-After` |
| 500 | Unexpected error (`app.onError`), including a failed workflow start on publish | System-error page |

There's no 409. A state conflict, such as committing to a plan that was just called off, isn't an error for the user: the route redirects to the page, which shows the plan's current state (R6, R8, R11).

### 3.2 Field errors (422)

Each field error is a sentence under its field, in `--error`, linked with `aria-describedby`. Focus moves to the first invalid field. Messages:

| Rule | Message |
|------|---------|
| `city` missing or not in `CITIES` | Pick a city. |
| `area` empty | Add a rough area. |
| `timeWindow` empty | Add a rough time. |
| Any text over its limit | Keep it under N characters. (N = the field's limit) |
| `format` empty | Say what it is, like coffee or a walk. |
| `venue` empty | Add where it is. |
| `date` / `time` missing or malformed | Pick a date. / Pick a time. |
| Gathering not in the future | The gathering needs to be in the future. |
| `minimum` not an integer ≥ 2 | The minimum is at least 2 people, you included. |
| Only one of `deadlineDate` / `deadlineTime` given | Pick both a date and a time, or leave both empty. |
| Deadline not in the future (FR007) | The decide-by time needs to be in the future. |
| Deadline not before the gathering (FR007) | The decide-by time needs to be before the gathering. |
| `name` empty | Add your name. |
| `email` invalid | That email doesn't look right. |

### 3.3 Shared pages

| Page | Status | Copy (UX §8.2, §8.6) |
|------|--------|----------------------|
| Not found | 404 | "We can't find that plan. The link may be incomplete. Check it in your chat or email." Link: "Suggest a plan" → `/` |
| System error | 403 / 413 / 500 | "Something went wrong. Go back and try again." Link: "Start over" → `/`. Logged at `error` with the request id (500 only; 403 and 413 at `warn`) |

Both carry `noindex` and generic OG tags.

---

## 4. Rate limiting

Operator decision: per-IP and global caps on the two routes that cost money or send email to an arbitrary address. In-memory counters on the single machine (ADR 0003), about 30 lines in `src/web/rate-limit.ts`, with no new dependency. The counters reset on deploy, which is acceptable at PoC maturity.

| Route | Per IP | Global |
|-------|--------|--------|
| `POST /suggest` | 10 per 10 minutes | 200 per day |
| `POST /plans` | 5 per hour | 50 per day |

- **Key**: the `Fly-Client-IP` header. In development, where it's absent, use the socket's remote address.
- **Windows**: fixed windows. A "day" is the calendar day in `America/Los_Angeles`. The limits are constants in `src/config.ts` (`RATE_LIMITS`).
- **Counting**: every request that passes CSRF counts, including ones that then fail validation. The check runs **before** validation and before any Claude call or database write.
- **Response**: 429, `Retry-After: <seconds until the window resets>`, the same page re-rendered (R2 and R3 say how), logged at `warn` without the IP.
- `POST /p/:token/commit`, call-off, withdraw and check-in aren't limited. Each needs a capability link and a plan's worth of context.

There are no `X-RateLimit-*` headers, since nothing reads them.

---

## 5. Routes

### R1. GET `/`: Create page

Renders the create page in one of four states. No database write.

**Query parameters**:

| Param | Type | Description |
|-------|------|-------------|
| `suggestion` | UUID | A `suggestions.id`. If it's missing, not a UUID, or not found, the parameter is ignored and the plain inputs state renders (200, not 404) |
| `change` | `1` | With `suggestion`: show the inputs, pre-filled from that suggestion row, instead of the card ("Change" on the summary line) |

**States**:

| Condition | State (UX mockup) | Contents |
|-----------|-------------------|----------|
| No valid `suggestion` | Inputs (1a) | Suggest form (§R2 fields): `city` `<select>` with no default, `area`, `timeWindow`, **Suggest a plan** |
| `suggestion` → `outcome='ok'` | Suggestion (1b) | Summary line "City · area · time" with **Change** (→ `/?suggestion=<id>&change=1`). Suggestion card pre-filled from the row: `format`, `venue`, `date`/`time` from `gathering_at`, `minimum`, `deadlineDate`/`deadlineTime` from `commit_deadline_at`. Below it, your details and **Publish plan** (the R3 form). **Suggest another** (an R2 form with hidden `city`, `area`, `timeWindow` and `previousSuggestionId=<id>`) |
| `suggestion` → `outcome='failed'` | Fallback (1c) | Summary line + notice "We couldn't come up with a suggestion just now. Fill in your own below, or try again." The R3 form with empty `format`, `venue`, `date`, `time` and `deadlineDate`/`deadlineTime`, and `minimum=3`, all rows in edit mode. **Try suggesting again** (the same hidden R2 form as Suggest another) |
| `suggestion` + `change=1` | Inputs (1a), pre-filled | The suggest form with the row's `city`, `area` and `timeWindow`, plus hidden `previousSuggestionId=<id>` |

The publish form on the ok state carries hidden `suggestionId=<id>`, `city`, `area` and `timeWindow`. The fallback state carries the last three and no `suggestionId`.

**Without JS**, the card renders every row as its input, styled as read rows. `create.js` adds the Edit/Done toggles, the recompute of **Decide by** when **When** changes (UX §6.1 step 2), the spinner text on **Suggest a plan** and **Suggest another**, copy and share. The server rule in R3 (deadline resolution) gives the same result without JS.

A suggestion whose `gathering_at` is now in the past still renders. R3's validation catches it on publish.

---

### R2. POST `/suggest`: Ask for a suggestion

Operator decision: **POST → 303 → GET**. The `suggestions` row, ok or failed, is what R1 renders from, so refresh and back never call Claude again.

**Form fields**:

| Field | Required | Rule |
|-------|----------|------|
| `city` | Yes | One of `CITIES` (architecture, Configured cities) |
| `area` | Yes | 1–200 chars after trim |
| `timeWindow` | Yes | 1–200 chars after trim |
| `previousSuggestionId` | No | UUID. Stored as `previous_suggestion_id` if a `suggestions` row with that id exists, otherwise stored as null (no error) |

**Flow**:
1. Rate limit (§4). Over the limit → **429**, rendering the create page with the submitted inputs as the summary line, the notice "Lots of suggestions just now. Fill in your own below, or try again in a few minutes.", and the **fallback card** (the R1 failed state without a `suggestionId`), so the creator can still publish. No `suggestions` row (Claude wasn't called).
2. Validate. Invalid → **422**, re-rendering the inputs state with the entered values and field errors.
3. Call `suggest()` (`src/suggest/suggest.ts`): Sonnet 5.5, a 20s hard limit (ADR 0004). This never throws to the route. A failure becomes `outcome='failed'` with a `failure_reason`.
4. Insert one `suggestions` row with the inputs, the outcome, the proposal fields if ok, the default `commit_deadline_at` (FR007, computed now with the rule in R3), and `latency_ms`.
5. **303** → `/?suggestion=<suggestions.id>`.

A database error in step 4 → 500 (`app.onError`). Claude failures are never a 5xx (FR004).

---

### R3. POST `/plans`: Publish

Publishes a plan from the create page (R1) or from a plan's new-plan page (R9).

**Form fields**:

| Field | Required | Rule | Stored as |
|-------|----------|------|-----------|
| `city` | Yes | One of `CITIES` | `plans.city` |
| `area` | Yes | 1–200 | `plans.area` |
| `timeWindow` | Yes | 1–200 | `plans.time_window` |
| `suggestionId` | No | UUID of a `suggestions` row with `outcome='ok'`. Otherwise it's treated as absent (no error) | `plans.suggestion_id` |
| `fromManageToken` | No | 43-char token matching some `plans.manage_token`. Otherwise it's treated as absent (no error). Sent only by R9's form | `plans.from_plan_id` = that plan's id |
| `format` | Yes | 1–40 | `plans.format` |
| `venue` | Yes | 1–120 | `plans.venue` |
| `date` | Yes | `YYYY-MM-DD`, a real date | with `time` → `plans.gathering_at` |
| `time` | Yes | `HH:MM`, 00:00–23:59 | |
| `minimum` | Yes | Integer ≥ 2 that fits a Postgres `integer` (FR006; no other upper limit) | `plans.minimum` |
| `deadlineDate` | No | `YYYY-MM-DD`. Both deadline fields or neither | with `deadlineTime` → `plans.commit_deadline_at` |
| `deadlineTime` | No | `HH:MM` | |
| `name` | Yes | 1–80 | creator's `commits.name` |
| `email` | Yes | Valid email (`z.email()`), 3–254 chars | `commits.email`; `email_normalized = lower(email)` |

If both `suggestionId` and `fromManageToken` arrive, `fromManageToken` wins and `suggestion_id` is null. R9's form never sends both.

**Deadline resolution** (FR007). It runs after the gathering instant is parsed, with `now` passed in (plan rules are pure):
1. **Default** = `min(gathering − 48h, now + (gathering − now) / 2)`, rounded down to the whole minute.
2. If both deadline fields are empty → use the default.
3. If `suggestionId` is valid, the submitted deadline equals the suggestion's `commit_deadline_at`, and the submitted gathering differs from the suggestion's `gathering_at` → use the default. The creator changed **When** and left **Decide by** alone, so the server recomputes it the way the UX does (UX §6.1).
4. Otherwise use the submitted deadline.

**Validation** (all of it is collected, then shown together):
- Field rules above.
- Gathering > now.
- Deadline > now, and deadline < gathering (FR007). The error goes under **Decide by**.

**Flow**:
1. Rate limit (§4). Over the limit → **429**, re-rendering the same create page (R1 shape, or R9 shape if `fromManageToken` is valid) with everything entered kept, and the notice "Lots of plans from here just now. Try again in a little while."
2. Validate. Invalid → **422**, re-rendering the same page with everything kept. Rows with errors are open in edit mode.
3. `publish()` in `src/domain/plans.ts` (architecture, Data flow publish). Generate `publicToken`, `manageToken`, `checkInToken` and the creator's `withdrawToken`, and compute the schedule. In one transaction: insert the plan (`state='open'`, `suggestion_edited` per the schema), the creator's commit (`is_creator=true`), and the `plan.published` (`fromPlanId`) and `commit.added` (`change:'new'`, `isCreator:true`, `activeCount:1`) events. Start `planWorkflow` (`plan-<planId>`) inside the transaction, then commit.
   - The workflow start fails → roll back → **500**.
4. Send the `manage_link` email via `sendOnce`. **A send failure doesn't fail the request.** Log it at `error` and carry on; the ledger row stays unsent, and R4 shows it (below).
5. **303** → `/m/<manageToken>/published`.

A double tap on **Publish plan** with JS off can create two plans. `create.js` disables the button on submit. That's accepted at PoC maturity.

---

### R4. GET `/m/:token/published`: Published screen

Lookup by `plans.manage_token`. Miss → 404.

**200** page (UX §6.1 Success, mockup 2):
- "Your plan is ready to share".
- Link box with the public link (`BASE_URL/p/<publicToken>`) and **Copy**. **Share…** appears only when `navigator.share` exists, with the text "<Format> at <Venue>, <Sat 9 Nov 10:00 AM> — I'm in, who else?".
- Meta line, depending on the creator's `manage_link` row in `email_sends`:
  - `sent_at` set: "We've emailed you a private link to manage the plan. Keep it to yourself."
  - Not sent: "We couldn't email you your private link. Bookmark the link below to manage the plan."
- Quiet link **Manage your plan** → `/m/<token>`.
- `noindex`, generic OG tags.

The page renders the same at any later visit, whatever the plan's state.

---

### R5. GET `/p/:token`: Public plan page

Lookup by `plans.public_token`, plus the plan's active commits (`withdrawn_at IS NULL`, ordered by `created_at`): one query. Miss → 404.

**Query parameters** (both set only by R6's redirect; unknown values are ignored):

| Param | Values | Effect |
|-------|--------|--------|
| `notice` | `in`, `on`, `updated`, `closed` | Shows a notice at the top (`role="status"`). With `in`, `on` or `updated`, the commit form is **replaced by the notice** (UX §6.2 step 3) |
| `n` | first name, ≤ 16 chars | The name in the notice. Ignored without `notice`. HTML-escaped. Never an email |

| `notice` | Copy | Style |
|----------|------|-------|
| `in` | You're in, {n}. We'll email you if it's on. | neutral |
| `on` | You're in, {n}. It's on! We've emailed you the details and we'll remind you the day before. | `--on-tint` |
| `updated` | Updated: you're in as {n}. | neutral |
| `closed` | This one isn't taking commits any more. | neutral |

**Display state**, derived at request time from the row and `now`:

| Condition | Pill | Seat row | Form |
|-----------|------|----------|------|
| `open`, now < deadline | Needs N more (N = max(minimum − count, 0)) | Filled seats, then empty seats up to the minimum; the first empty one says "you?" | Yes |
| `confirmed`, now < gathering | It's on | All filled in `--on`; "More people are welcome until it starts." | Yes (FR014) |
| `confirmed`, gathering ≤ now < gathering + 3h | Happening now | Filled | No |
| `confirmed`, now ≥ gathering + 3h | This was on Sat 9 Nov | Filled | No |
| `called_off`, or `open` with now ≥ deadline (not resolved yet) | Not this time | None, no count | No. "This one isn't going ahead. No harm done. Maybe next time." + "Want to try your own? Suggest a plan" → `/` |

The 3h "happening now" window is this spec's choice; the UX spec doesn't give one.

**Commit form** (R6): `name` (`autocomplete="name"`, `autocapitalize="words"`), `email` (`type="email"`, `inputmode="email"`, help "Only used to tell you if it's on. Never shown to anyone."), **I'm in**.

**Head**: OG tags per UX §8.10. `og:title` "<Format> at <Venue>"; `og:description` "<Sat 9 Nov · 10:00 AM> · <City>. Goes ahead if <minimum> are in." (+ " It's on." when confirmed; "Not this time" when called off); `og:image` `BASE_URL/static/og.png`; `og:site_name` "calvin". `noindex` (§2).

No JS, no image other than the OG tag, one stylesheet (NFR002).

---

### R6. POST `/p/:token/commit`: Commit

**Form fields**:

| Field | Required | Rule |
|-------|----------|------|
| `name` | Yes | 1–80 after trim |
| `email` | Yes | Valid email, 3–254 chars, trimmed. Dedupe key `lower(email)` (FR013) |

**Flow**:
1. Token lookup. Miss → 404.
2. Validate. Invalid → **422**, re-rendering R5 (current state) with the entered values and field errors.
3. `commit()` in `src/domain/plans.ts`, in one transaction with the plan row locked (architecture, Data flow commit):
   - Refuse, with no write and no event, if the plan is `called_off`, if it's `open` and now ≥ deadline, or if now ≥ gathering (FR015). → **303** `/p/:token?notice=closed`.
   - Upsert on `(plan_id, email_normalized)`. `change` is `new` (inserted), `repeat` (it existed and was active) or `rejoined` (it existed and was withdrawn; `withdrawn_at` is cleared).
   - If the plan is `open`, count ≥ minimum and now < deadline → `confirmed`, with the `plan.confirmed` event (FR018).
   - `commit.added` event with `change`, `isCreator`, `activeCount`.
4. After the commit, signals are fire-and-forget; a failure is logged at `error` and the user's commit stands (ADR 0002):
   - This commit confirmed the plan → signal `confirmed`.
   - The plan was already confirmed and `change` is `new` or `rejoined` → signal `committed(commitId)`.
5. **303** → `/p/:token?notice=<code>&n=<firstName>`, where `n` is the URL-encoded first word of `name`, capped at 16 chars:

| Outcome | `notice` |
|---------|----------|
| `change = repeat` | `updated` |
| `new` or `rejoined`, plan now `confirmed` | `on` |
| `new` or `rejoined`, plan still `open` | `in` |

A committer whose email already got the `confirmed` email (they withdrew and came back) isn't emailed again. The ledger keys on `(commit_id, kind)` (database-schema, commits).

---

### R7. GET `/m/:token`: Manage page

Lookup by `plans.manage_token`, plus active commits. Miss → 404.

**200** page (UX mockup 4, FR026):
- State pill as on R5. The open pill appends " · decide by Thu 7 Nov, 10:00 AM".
- Count against the minimum, and the **full names** of active commits (plain list when called off). No email addresses.
- The public link, with **Copy**.
- Actions:

| Action | Shown when | Form / link |
|--------|------------|-------------|
| **Call it off** | Plan isn't `called_off` and now < gathering | `<details>` with `<summary>` "Call it off" (quiet). Inside: "Call it off? Everyone who's in gets a short "not this time" email.", **Keep it** (link → `/m/:token`, closes it without JS) and a `<form method="post" action="/m/:token/call-off">` with the **Call it off** button. No fields |
| **Start a new plan from this** | Always (FR025). Primary when called off, secondary otherwise | Link → `/m/:token/new` |

**Query parameter** `notice=too-late` (set by R8 only): "It's already started, so it can't be called off."

`noindex`, generic OG tags.

---

### R8. POST `/m/:token/call-off`: Call off

No form fields.

**Flow**:
1. Token lookup. Miss → 404.
2. `callOff()` in `src/domain/plans.ts`, plan row locked:
   - Already `called_off` → no write. **303** `/m/:token` (idempotent).
   - now ≥ gathering (FR023) → no write. **303** `/m/:token?notice=too-late`.
   - Otherwise set `state='called_off'`, `called_off_at=now`, `called_off_reason='creator'`, plus the `plan.called_off` event (`reason:'creator'`, `wasConfirmed`, `activeCount`).
3. After the commit: signal `calledOff` (failure logged, ADR 0002).
4. **303** `/m/:token`.

---

### R9. GET `/m/:token/new`: New plan from this plan

Lookup by `plans.manage_token`. Miss → 404. Available in every state (FR025).

**200**: the create page in the suggestion-card shape (UX §6.3 step 3), without **Suggest another** and without **Change**. Leaving for a fresh suggestion would drop the link to the old plan. The R3 form is pre-filled:

| Field | Value |
|-------|-------|
| `city`, `area`, `timeWindow` | From the old plan (hidden; shown as the summary line, read-only) |
| `format`, `venue`, `minimum` | From the old plan |
| `date`, `time` | Empty, in edit mode |
| `deadlineDate`, `deadlineTime` | Empty (R3 computes the default if they stay empty) |
| `name`, `email` | From the old plan's creator commit |
| `fromManageToken` | Hidden: the old plan's manage token |

Publishing goes through R3 and gets new tokens and a new workflow. The creator is the only committer, and the old committers aren't emailed. `noindex`.

---

### R10. GET `/w/:token`: Withdraw page

Lookup by `commits.withdraw_token`, joined to its plan. Miss → 404. **The creator's commit → 404** (FR017; the creator's emails carry no withdraw link).

**Query parameter** `done=1`: set by R11's redirect. The view is chosen from the database, not from `done`, so a committer who withdrew and then committed again sees the confirm view.

| Condition | View |
|-----------|------|
| Plan `called_off` | "This one isn't going ahead, so there's nothing to withdraw from." No button |
| now ≥ gathering | "This one has already started." No button |
| `withdrawn_at` set | Done (mockup 5): "You're out. You've withdrawn from <Format> on <Sat 9 Nov>. No more emails about it." |
| Otherwise | Confirm: "Withdraw from <Format> at <Venue> on <Sat 9 Nov>?" + a `<form method="post" action="/w/:token">` with **Withdraw** (primary). No fields |

The withdraw itself is a POST, so email link scanners that GET the link can't withdraw anyone (UX §6.2). `noindex`, generic OG tags.

---

### R11. POST `/w/:token`: Withdraw

No form fields.

**Flow**:
1. Token lookup. Miss or creator → 404.
2. `withdraw()` in `src/domain/plans.ts`, plan row locked:
   - Plan `called_off`, or now ≥ gathering → no write. **303** `/w/:token` (the page explains).
   - Already withdrawn → no write. **303** `/w/:token?done=1`.
   - Otherwise set `withdrawn_at=now`, plus the `commit.withdrawn` event (`activeCount`). The plan's state doesn't change, even if the count drops below the minimum on a confirmed plan (FR017).
3. **303** `/w/:token?done=1`.

No signal: emails read the active commits when they're sent (architecture, Implementation Guide 7).

---

### R12. GET `/c/:token/:question/:answer`: Check-in answer

| Path param | Values |
|------------|--------|
| `:token` | `plans.check_in_token` |
| `:question` | `happened` ("Did it happen?") or `attended` ("Were you there?") |
| `:answer` | `yes` or `no` |

Any other value, a token miss, or a plan whose state isn't `confirmed` (called-off plans get no check-in, FR027) → 404.

**Flow**: upsert `check_in_answers (plan_id, question)` with `answer = (answer == 'yes')` (FR028, answering again replaces), plus the `check_in.answered` event, in one transaction. **200** thank-you page.

This GET writes on purpose (UX §6.4): a re-answer replaces the earlier one, and a link prefetch at worst writes a default the creator can correct. Hono also answers `HEAD` with the GET handler, so a scanner's HEAD writes too, which is just as harmless.

**Thank-you page**:

| Answered | Copy |
|----------|------|
| `happened/yes` | Thanks! Got it: it happened. |
| `happened/no` | Thanks! Got it: it didn't happen. |
| `attended/yes` | Thanks! Got it: you were there. |
| `attended/no` | Thanks! Got it: you weren't there. |

If the other question has no answer yet, the page shows it with **Yes** and **No** links (`/c/:token/<other>/yes|no`), so one email takes two taps. `noindex`, generic OG tags.

---

### R13. GET `/healthz`

**200**, `text/plain`, body `ok`. It **doesn't query the database**: Fly's check runs every few seconds and would keep Neon's Free plan from scaling to zero (architecture, Neon). It's not logged at `info`.

### R14. GET `/static/:file`

`serveStatic` from `@hono/node-server/serve-static`, root `./public`. Files: `app.css`, `create.js`, `og.png`. `Cache-Control: public, max-age=86400`. Unknown file → 404 (plain text; no page is needed).

---

## 6. Temporal signals sent by routes

These aren't HTTP, but the routes above are their only senders. They're listed here so one place shows each route's side effects (architecture, Novel Pattern).

| Signal | Sent by | When | Arg |
|--------|---------|------|-----|
| `confirmed` | R6 | This commit confirmed the plan | — |
| `committed` | R6 | The plan was already confirmed, and the commit is `new` or `rejoined` | `commitId` |
| `calledOff` | R8 | The creator called the plan off | — |

All are sent after the database transaction commits, to workflow ID `plan-<planId>`. A failure is logged at `error` and never shown to the user.

---

## 7. Logging per request

The request logger (architecture, Logging Strategy) writes method, the path with tokens replaced by `:token` (every segment after `/p/`, `/m/`, `/w/`, `/c/`), status and duration. It never logs form bodies, query strings (they can hold `n`), emails, tokens or `Fly-Client-IP`.

---

## 8. Testing notes

Routes are tested with `app.request()` (architecture, Testing). Form requests must set `Content-Type: application/x-www-form-urlencoded`, or the validator sees `{}`, and must set `Origin: <BASE_URL>` to pass CSRF. Each route's outcome table above is its test list. That includes the 404 for a malformed token, which must not reach the database.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-10-27 | Initial route contract. Operator decisions: per-IP + global rate limits on `/suggest` and `/plans`; POST → 303 → `GET /?suggestion=<id>` for suggestions; `noindex` on every page except `/` |
