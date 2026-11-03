# Epics: calvin-2

Maturity: **poc**. Stories use the terms in the glossary (plan, creator, commit, committer, withdraw, minimum, count, commit deadline, confirmed, called off, gathering, check-in). Every criterion is checked by a test at a seam the test strategy names, unless it says "checked by hand". In that case the story's plan records how it was checked. A check that needs something a story session doesn't have (a phone, the Temporal CLI, a deploy) isn't a criterion: the story's text names it as a check the operator makes by hand after the merge. Test command `npx vitest run`, type check `npx tsc --noEmit`, and the setup command is the one in the factory config.

Every time is in `America/Los_Angeles`. The example plan used throughout is coffee at Blue Bottle, Oakland (rough area "Rockridge", rough time "next weekend, morning"), on Sat 14 Nov 2026 at 10:00 AM PST (`2026-11-14T18:00:00Z`), minimum 3, created by Ana Ruiz and published at Mon 9 Nov 2026 10:00 AM, so its commit deadline is Wed 11 Nov 2026 10:00 PM (`2026-11-12T06:00:00Z`).

**Decided in this stage: the default commit deadline floors at halfway.** FR007's default was the earlier of 48h before the gathering and halfway between publishing and the gathering. For a gathering less than 48h away, that default is in the past, and publishing would be refused. The operator's decision: use the earlier of the two when it's in the future, otherwise use halfway. The rule is still rounded down to the whole minute. PRD FR007 and the API specification's R3 deadline rule are updated to match.

**Carried on as calvin-2 (operator, 2026-11-02; lf-factory ADR 0015).** calvin's run merged Stories 1.1, 1.2, 1.3 and 1.6. This initiative builds the rest of Epic 1: Stories 1.4, 1.5, 1.7, 1.8 and 1.9, as shaped (calvin's `epics.md` at commit c989191). A prerequisite that calvin merged is written as None. Epics 2–4 are left out of this file; the PRD and the other documents still describe them.

## Epic 1: Create and publish a plan

A creator turns a city, a rough area and a rough time into a published plan, with a public link to paste in the chat and a manage link emailed to them. It covers FR001–FR010, NFR001, NFR003, NFR005 and NFR009. The starter code, the guardrails, publishing from the form and the public page are on `main` already (calvin's Stories 1.1, 1.2, 1.3 and 1.6).

### Story 1.4 (v1): Publishing refuses an invalid plan

As a creator, I want to be told exactly what's wrong when my plan can't be published, so that I can fix it without retyping anything.

Validation follows the API specification's R3 rules and §3.2 messages. Every error is collected and shown at once under its field, the page is re-rendered with 422, everything entered is kept, and nothing is stored. CSRF protection (`hono/csrf` with `origin: BASE_URL`) and the 16 KB body limit cover every POST from here on.

Prerequisites: None

Acceptance criteria:
- Given a form with no city, an empty area and an empty rough time, when it's published, then the response is 422 with "Pick a city.", "Add a rough area." and "Add a rough time." under those fields, the other entered values kept, and no plan stored.
- Given a city that isn't in `CITIES`, when the form is published, then the response is 422 with "Pick a city.".
- Given an empty format and an empty venue, when the form is published, then the response is 422 with "Say what it is, like coffee or a walk." and "Add where it is.".
- Given a venue of 121 characters, when the form is published, then the response is 422 with "Keep it under 120 characters.".
- Given a missing or malformed date or time, when the form is published, then the response is 422 with "Pick a date." or "Pick a time.".
- Given a gathering that isn't in the future, when the form is published, then the response is 422 with "The gathering needs to be in the future.".
- Given a minimum of 1, or one that isn't a whole number, when the form is published, then the response is 422 with "The minimum is at least 2 people, you included.".
- Given a minimum of 40, when the form is published, then the plan is published with minimum 40.
- Given only one of Decide by's date and time, when the form is published, then the response is 422 with "Pick both a date and a time, or leave both empty.".
- Given a Decide by that isn't in the future, when the form is published, then the response is 422 with "The decide-by time needs to be in the future." under Decide by.
- Given a Decide by at or after the gathering, when the form is published, then the response is 422 with "The decide-by time needs to be before the gathering." under Decide by.
- Given an empty name and an email "ana@", when the form is published, then the response is 422 with "Add your name." and "That email doesn't look right.".
- Given a POST whose `Origin` isn't `BASE_URL` and whose `Sec-Fetch-Site` isn't `same-origin`, when it's sent to `/plans`, then the response is the 403 system-error page and nothing is stored.
- Given a POST body over 16 KB, when it's sent to `/plans`, then the response is the 413 system-error page.

### Story 1.5 (v1): Email the creator their manage link

As a creator, I want my private manage link emailed to me, so that I can find my plan again later.

This story builds the email path every later email uses. `sendEmail(payload, idempotencyKey)` wraps Resend's `emails.send` and turns its `{ data, error }` into a return value or a thrown error: retryable for `rate_limit_exceeded`, 409 `concurrent_idempotent_requests` and 5xx, and `ApplicationFailure.nonRetryable` for validation, auth and quota errors. `sendOnce(kind, plan, commit)` inserts the `email_sends` row with `ON CONFLICT DO NOTHING`, returns if it's already sent, sends with idempotency key `<kind>/<planId>/<commitId>` and tag `kind=<kind>`, then sets `sent_at` and appends `email.sent`. The payload is plain text, built only from stored data. The manage-link email follows the UX spec's §8.9 and is sent in the publish request, after the transaction. Verifying the sending domain in Resend (SPF and DKIM, NFR009) is an operator task, done before the trial.

Prerequisites: None

Acceptance criteria:
- Given the example plan, when it's published, then `sendEmail` is called once to the creator's address with subject "Your plan: Coffee at Blue Bottle, Sat 14 Nov", a text body with the manage link `BASE_URL/m/<manageToken>` and the public link `BASE_URL/p/<publicToken>`, no withdraw link, tag `kind=manage_link`, and idempotency key `manage_link/<planId>/<creatorCommitId>`.
- Given the manage-link email was sent, when the published screen is shown, then it reads "We've emailed you a private link to manage the plan. Keep it to yourself.".
- Given `sendEmail` fails, when the plan is published, then the response is still 303 to the published screen, the failure is logged at `error` with no email address in the log line, and the screen reads "We couldn't email you your private link. Bookmark the link below to manage the plan.".
- Given `sendOnce` has already sent a kind to a committer, when it's called again for the same kind and committer, then `sendEmail` isn't called again, there's still one `email_sends` row, and one `email.sent` event.
- Given a first `sendOnce` call whose send failed, when it's called again, then `sendEmail` gets the same payload and the same idempotency key as the first call.
- Given Resend answers `rate_limit_exceeded` or a 5xx, when `sendEmail` runs, then it throws a retryable error, and given it answers a validation or auth error, then it throws a non-retryable one.

### Story 1.7 (v1): Get a suggestion

As a creator, I want calvin to suggest a concrete plan from my city, rough area and rough time, so that I have something specific to offer.

`GET /` now opens on the inputs state (UX mockup 1a): city, rough area, rough time and **Suggest a plan**. `POST /suggest` (the API specification's R2) validates, calls `suggest()`, stores one `suggestions` row (ok or failed, with `latency_ms` and the default commit deadline), and redirects 303 to `/?suggestion=<id>`. `GET /` renders the suggestion card (mockup 1b) or the fallback (mockup 1c) from that row, so a refresh never calls Claude again. `suggest()` follows ADR 0004 and the architecture's Anthropic configuration: `claude-sonnet-5-5`, `web_search_20260318` with `max_uses: 2` and an approximate `user_location` for the city, the strict client tool `propose_plan`, `effort: "low"`, `timeout: 20_000`, `maxRetries: 0` and an abort signal at 20s. The prompt asks for a low-stakes format (coffee, drinks, a walk), never hosting at someone's home. Publishing from the card carries `suggestionId`, follows R3's deadline rule 3, and records `suggestion_edited`. The good recorded response is captured once by hand from a real call, with anything personal removed. The others are edits of it. Real latency (NFR001, ≤ 15s p95) is measured by hand over at least 10 real calls. If it's over, `max_uses` drops to 1.

Prerequisites: Story 1.4

Acceptance criteria:
- Given Oakland, "Rockridge" and "next weekend, morning", when they're submitted to `POST /suggest` with the recorded good response, then the response is 303 to `/?suggestion=<id>`, and that page shows the summary "Oakland · Rockridge · next weekend, morning", a card with the proposal's format, venue, when, minimum and Decide by, and the publish form with your name and email.
- Given a suggestion request, when `suggestPlanCall` is called, then the request names model `claude-sonnet-5-5`, the `web_search_20260318` tool with `max_uses: 2` and `user_location` city "Oakland", region "California", country "US" and timezone "America/Los_Angeles", and the `propose_plan` tool with `strict: true`, and it sets no `temperature`, no `thinking: disabled` and no forced `tool_choice`.
- Given a response with no `propose_plan` call, or one that ends in `pause_turn`, `refusal` or `max_tokens`, or an API error, or no answer within 20 seconds, when the suggestion is requested, then the `suggestions` row is failed with the matching `failure_reason`, and the page shows "We couldn't come up with a suggestion just now. Fill in your own below, or try again." with empty format, venue, date, time and Decide by, minimum 3, and never a 5xx.
- Given a `propose_plan` call with minimum 1 or an empty venue, when the suggestion is requested, then the row is failed with reason `invalid_proposal` and the fallback is shown.
- Given empty inputs, when they're submitted to `POST /suggest`, then the response is 422 with "Pick a city.", "Add a rough area." and "Add a rough time." and Claude isn't called.
- Given a suggestion page, when it's requested a second time, then `suggestPlanCall` isn't called again.
- Given `GET /?suggestion=` with a value that isn't a UUID or matches no row, when it's requested, then it answers 200 with the plain inputs state.
- Given an ok suggestion published without changes, when the plan is read back, then its `suggestion_id` is that suggestion and `suggestion_edited` is false.
- Given an ok suggestion published with its venue changed, when the plan is read back, then `suggestion_edited` is true.
- Given an ok suggestion whose When is changed while Decide by is left at the suggestion's default, when it's published, then the commit deadline is the default for the new When, not the suggestion's.
- Given a plan published from the fallback form, when it's read back, then it has no `suggestion_id`.
- Given 10 real suggestion calls for different cities, when their `latency_ms` is read, then the p95 is at most 15 seconds (checked by hand).

### Story 1.8 (v2): Suggest another, change the inputs, and copy the link

As a creator, I want to ask for a different suggestion, change what I typed, and copy or share the link in one tap, so that I get to a plan I like fast.

**Suggest another** and **Try suggesting again** are R2 forms with hidden `city`, `area`, `timeWindow` and `previousSuggestionId`. **Change** links to `/?suggestion=<id>&change=1`. The create page's script, `/static/create.js`, served under the CSP nonce, only enhances: Edit/Done toggles on the card rows, recomputing Decide by when When changes (unless the creator edited Decide by), the spinner text "Finding something nearby…" and "Picking a time…", **Copy** reading "Copied" for 2s, **Share…** only where `navigator.share` exists (text "Coffee at Blue Bottle, Sat 14 Nov 10:00 AM — I'm in, who else?"), and disabling **Publish plan** on submit. The script has no automated tests at poc; the plan records the checks a session can make by reading the code.

After the merge, the operator checks by hand on a phone with JS on: when the creator edits When on a card and taps **Copy** and **Share…** on the published screen, Decide by updates, the button reads "Copied" for 2s, and the native share sheet opens with the share text. A story session doesn't have a phone, so this check is not a criterion.

Prerequisites: Story 1.7

Acceptance criteria:
- Given a suggestion card, when **Suggest another** is submitted, then a new `suggestions` row is stored with `previous_suggestion_id` set to the old one, and the page shows the new card.
- Given the fallback card, when **Try suggesting again** is submitted, then a new suggestion is requested from the same inputs with `previous_suggestion_id` set.
- Given a `previousSuggestionId` that matches no row, when `POST /suggest` is submitted, then the new row's `previous_suggestion_id` is null and no error is shown.
- Given a suggestion, when `GET /?suggestion=<id>&change=1` is requested, then the inputs state is shown pre-filled with that suggestion's city, area and rough time, with a hidden `previousSuggestionId`.
- Given the create page, when its HTML is read, then it loads `/static/create.js` with the response's CSP nonce, and the suggest and publish forms are plain POST forms that work without the script.

### Story 1.9 (v2): Rate limits on suggesting and publishing

As the operator, I want suggesting and publishing capped per IP and per day, so that nobody can run up the Claude bill or email arbitrary addresses at scale.

The limits are the API specification's §4: fixed windows, in-memory counters, keyed by the `Fly-Client-IP` header (the socket address in development), a "day" being the calendar day in `America/Los_Angeles`, and the limits as constants in config. Every request that passes CSRF counts, checked before validation and before any Claude call or database write.

Prerequisites: Story 1.7

Acceptance criteria:
- Given 10 suggestion requests from one IP within 10 minutes, when an 11th arrives, then the response is 429 with a `Retry-After` header, the create page shows "Lots of suggestions just now. Fill in your own below, or try again in a few minutes." with the fallback card, Claude isn't called, and no `suggestions` row is stored.
- Given 200 suggestion requests on one Los Angeles calendar day from different IPs, when a 201st arrives, then it gets 429.
- Given 3 publish requests from one IP within an hour, when a 4th arrives, then the response is 429 with "Lots of plans from here just now. Try again in a little while.", everything entered kept, and no plan stored.
- Given 50 publish requests on one Los Angeles calendar day, when a 51st arrives, then it gets 429.
- Given one IP at its limit, when a request arrives from another IP, then it isn't limited.
- Given 10 invalid suggestion requests from one IP, when an 11th valid one arrives within 10 minutes, then it gets 429.
- Given a request is limited, when it's logged, then the line is at `warn` and doesn't contain the IP.
