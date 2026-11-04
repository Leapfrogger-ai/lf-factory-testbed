# Epics: calvin-4

Maturity: **poc**. Stories use the terms in the glossary (plan, creator, commit, committer, withdraw, minimum, count, commit deadline, confirmed, called off, gathering, check-in). Every criterion is checked by a test at a seam the test strategy names, unless it says "checked by hand". In that case the story's plan records how it was checked. A check that needs something a story session doesn't have (a phone, the Temporal CLI, a deploy) isn't a criterion: the story's text names it as a check the operator makes by hand after the merge. Test command `npx vitest run`, type check `npx tsc --noEmit`, and the setup command is the one in the factory config.

Every time is in `America/Los_Angeles`. The example plan used throughout is coffee at Blue Bottle, Oakland (rough area "Rockridge", rough time "next weekend, morning"), on Sat 14 Nov 2026 at 10:00 AM PST (`2026-11-14T18:00:00Z`), minimum 3, created by Ana Ruiz and published at Mon 9 Nov 2026 10:00 AM, so its commit deadline is Wed 11 Nov 2026 10:00 PM (`2026-11-12T06:00:00Z`).

**Decided in this stage: the default commit deadline floors at halfway.** FR007's default was the earlier of 48h before the gathering and halfway between publishing and the gathering. For a gathering less than 48h away, that default is in the past, and publishing would be refused. The operator's decision: use the earlier of the two when it's in the future, otherwise use halfway. The rule is still rounded down to the whole minute. PRD FR007 and the API specification's R3 deadline rule are updated to match.

**Carried on as calvin-4 (operator, 2026-11-04; lf-factory ADR 0015).** calvin, calvin-2 and calvin-3 merged all of Epics 1 and 2. This initiative builds Epic 3: Stories 3.1 to 3.6 as shaped (calvin's `epics.md` at commit c989191), changed by the operator's answers on the Epic 3 mockups (testbed #191), plus a new Story 3.7. A prerequisite already merged is written as None. Epics 1, 2 and 4 are left out of this file; the PRD and the other documents still describe them.

**Visual reference: [ux/epic-3.html](./ux/epic-3.html)** (testbed #191, approved by the operator on 2026-11-04). It draws every Epic 3 screen and every built screen in the new look, at 360px, in light and dark. Its frames are named B1–B5 (built screens), M1–M5 (manage page), P1, P2 and W1 (a called-off plan), N1 and N2 (new from old) and E1–E4 (emails). A story that renders a screen names the frames it must match: the same copy, the same order of elements, and the class names the frame uses. The acceptance check compares the story's rendered HTML with those frames. How it looks on a real phone is an operator check after the merge.

**Decided on the mockups (operator, 2026-11-04, #191):**
1. The manage page lists full names with the same initial tokens as the public seats (frame M1). In 3.4.
2. The "not this time" email carries no withdraw link, since there's nothing to withdraw from. 3.1's second criterion is changed, and PRD FR016 and the API specification's withdraw-link row say so.
3. The new palette (berry on lilac-grey) and the serif for the venue replace ux-spec §4.1 and §4.2.
4. A separate story, 3.7, brings the built screens to the new design before 3.4. It's numbered 3.7 so the story numbers in the sheet and the issues stay right.
5. The proposed email body lines are approved. They're written into 3.2 and 3.3.
6. 3.6's heading is "Same again, new date".

## Epic 3: Confirm, remind and call off

Plans confirm or get called off on their own and through the manage link, with the right emails at the right times, each sent once. It covers FR019–FR026, NFR007 and NFR008. Story 3.7 brings the screens built in Epics 1 and 2 to the new look first, so the whole app reads as one.

### Story 3.1 (v1): Call off a plan that misses its minimum

As a committer, I want a plan that didn't reach its minimum to be dropped quietly, so that nobody turns up to an empty room.

`planWorkflow` gets its open phase: it waits with `condition(() => confirmed || calledOff, deadline − now)` and, on timeout, calls the `resolveDeadline` activity, which moves an open plan to called off only if the count is below the minimum, then returns the plan's real state. The called-off path sends `not_this_time` to every active committer through `sendToCommitters`, then ends. Activities come from `createActivities({ db, sendEmail })`, re-read Postgres, and send through `sendOnce`. Activity options follow the architecture's Implementation Guide: `startToCloseTimeout` 30s, `scheduleToCloseTimeout` 12h, and retry from 5s with backoff 2 up to 10m. Workflow code imports only `@temporalio/workflow` and types. Every email to a committer other than the creator carries a "Can't make it? Withdraw" link (FR016), except "not this time", which has nothing to withdraw from (operator, #191). Tests use the time-skipping test environment. The called-off pages match frames P1, P2 and W1, and the email matches E2.

Prerequisites: None

Acceptance criteria:
- Given the example plan with 2 active commits, when its workflow reaches the commit deadline, then the plan is called off with reason `deadline`, a `plan.called_off` event is recorded with `reason: "deadline"`, `wasConfirmed: false` and `activeCount: 2`, and each active committer gets one email with subject "Not this time: Coffee on Sat 14 Nov".
- Given a "not this time" email, when its text is read, then it says "This one didn't come together, and that's fine. Nobody's going, so there's nothing to do.", names no one, gives no count, and carries no withdraw link (no `/w/` URL), for every committer including the creator.
- Given a committer who withdrew before the deadline, when the plan is called off, then they get no email.
- Given a plan that reached its minimum but whose `confirmed` signal never arrived, when its workflow reaches the deadline, then `resolveDeadline` leaves it confirmed and no "not this time" email is sent.
- Given the first send of a "not this time" email fails, when the activity is retried, then each committer still gets exactly one email.
- Given a called-off plan, when its public page is requested, then it shows "Not this time" in a pill with class `state-off`, with no form, as in frame P1, and `og:description` reads "Not this time".
- Given a called-off plan, when someone commits, then the response redirects with `notice=closed` and nothing is stored, and the page it lands on matches frame P2.
- Given a called-off plan, when a committer's withdraw page is requested, then it reads "This one isn't going ahead, so there's nothing to withdraw from." with no button, as in frame W1.

### Story 3.2 (v1): Confirmation emails

As a committer, I want an email the moment the plan is on, so that I know to keep the time free.

On the `confirmed` signal, or when `resolveDeadline` finds the plan confirmed, the workflow sends `confirmed` to every active committer. While confirmed, a `committed(commitId)` signal sends `confirmed` to that one committer straight away (FR019). Each committer gets it at most once, even if they withdraw and rejoin (the ledger keys on commit and kind). The email is frame E1. Its body, for Mia in the example plan, is exactly:

```
It's on. Ana, Mia, Raj are in.

Coffee at Blue Bottle
Sat 14 Nov · 10:00 AM
Map: https://maps.google.com/?q=Blue+Bottle+Oakland

We'll remind you the day before and that morning.

Can't make it? Withdraw: BASE_URL/w/<withdrawToken>
```

The creator's copy has no withdraw line.

Prerequisites: Story 3.1

Acceptance criteria:
- Given the example plan with Ana, Mia and Raj in, when it's confirmed, then each of them gets one email with subject "It's on: Coffee at Blue Bottle, Sat 14 Nov 10:00 AM", and Mia's body is the text above with her own withdraw link.
- Given the confirmation email to Ana, the creator, when its text is read, then it's the same text without the "Can't make it? Withdraw" line.
- Given a confirmed plan, when Lee commits before the gathering, then Lee gets the confirmation email straight away and nobody else gets a second one.
- Given a plan confirmed by a commit whose signal failed, when its workflow reaches the deadline, then every active committer gets the confirmation email then.
- Given the `confirmed` signal arrives twice, when the workflow handles it, then each committer still gets one confirmation email.
- Given a committer who withdrew before the plan was confirmed, when it's confirmed, then they get no confirmation email.
- Given Mia got the confirmation email, withdrew and rejoined, when her rejoin is signalled, then she isn't emailed again.

### Story 3.3 (v1): Reminders before the gathering

As a committer, I want reminders the day before and the morning of, so that I actually show up.

While confirmed, the workflow waits on timers for the 24h reminder and the morning reminder from the schedule, skipping any whose time has passed. It records when the 24h reminder actually went out, and skips the morning one if that was less than 6h before it (FR020, FR021). Each reminder goes to the active committers at that moment, and lists who's in at that moment. The emails are frames E3 and E4. For Mia in the example plan, the 24h reminder's body is exactly:

```
Tomorrow at 10:00 AM: Coffee at Blue Bottle, Oakland.
Map: https://maps.google.com/?q=Blue+Bottle+Oakland

Who's in: Ana, Mia, Raj.

Can't make it? Withdraw: BASE_URL/w/<withdrawToken>
```

The morning reminder is the same, starting "Today at 10:00 AM:". The creator's copies have no withdraw line.

Prerequisites: Story 3.2

Acceptance criteria:
- Given the example plan confirmed before Fri 13 Nov, when its workflow runs, then each active committer gets "Tomorrow: Coffee at Blue Bottle, 10:00 AM" at `2026-11-13T18:00:00Z` and "Today: Coffee at Blue Bottle, 10:00 AM" at `2026-11-14T16:00:00Z`.
- Given the example plan with Ana, Mia and Raj in, when the reminders are read, then Mia's 24h reminder body is the text above with her own withdraw link, her morning reminder is the same text starting "Today at 10:00 AM:", and Ana's copies have no withdraw line.
- Given a confirmed plan for 09:30 on 2026-11-14, when its workflow runs, then only the 24h reminder is sent.
- Given the example plan published with Decide by Sat 14 Nov 2026 6:00 AM and confirmed at Fri 13 Nov 2026 8:00 PM, when its workflow runs, then the 24h reminder is skipped and the morning reminder is sent at `2026-11-14T16:00:00Z`.
- Given a committer who joins a confirmed plan after its 24h reminder went out, when the workflow runs, then they get the confirmation email and the morning reminder, and no 24h reminder.
- Given the example plan's 24h reminder send fails until Sat 14 Nov 2026 3:00 AM and then succeeds, when 08:00 comes, then the morning reminder is skipped.
- Given a committer who withdraws after the 24h reminder, when the morning reminder goes out, then they don't get it, and its "Who's in" line doesn't name them.
- Given a confirmed plan for Sun 1 Nov 2026 at 10:00, when its workflow runs, then the 24h reminder goes at `2026-10-31T18:00:00Z` and the morning reminder at `2026-11-01T16:00:00Z`.

### Story 3.4 (v1): See the plan on the manage page

As a creator, I want my manage link to show who's in and what I can do, so that I can follow my plan.

The manage page is the API specification's R7: a dark strip saying "Your plan. Only you can see this page.", the wordmark, the state pill, the plan, the count against the minimum, committers' full names (never emails) as a list with the same initial tokens as the public seats (operator, #191), the public link in a link box with **Copy**, and the actions. **Start a new plan from this** is a secondary button. **Call it off** is a quiet `<details>` with the inline confirm. Its POST is Story 3.5. The page matches frames M1, M2, M3 and M5, using the classes Story 3.7 adds.

Prerequisites: Story 3.7

Acceptance criteria:
- Given the example plan with Ana and Mia Chen in, when `GET /m/<manageToken>` is requested, then it shows, in this order, the strip "Your plan. Only you can see this page.", the wordmark "calvin", the pill "Needs 1 more · decide by Wed 11 Nov, 10:00 PM" with class `state-open`, the venue "Blue Bottle" as the `h1`, "2 of 3", and a list `<ul class="names" aria-label="Who's in">` with "Ana Ruiz" and "Mia Chen", each with an `aria-hidden` token showing their initial, then the public link `BASE_URL/p/<publicToken>` in a link box with **Copy**, a "Start a new plan from this" link to `/m/<manageToken>/new`, and a "Call it off" control, as in frame M1.
- Given the "Call it off" control is opened, when its content is read, then it says "Call it off? Everyone who's in gets a short "not this time" email." with a **Keep it** link to `/m/<manageToken>` and a **Call it off** form that posts to `/m/<manageToken>/call-off`, as in frame M2.
- Given a confirmed plan, when its manage page is requested, then the pill reads "It's on" with class `state-on` and the names list has class `names-on`, as in frame M3.
- Given a called-off plan, when its manage page is requested, then the pill reads "Not this time" with class `state-off`, the names are a list with class `names-off` and `aria-label="Who was in"`, with no count and no empty seats, there's no "Call it off", and "Start a new plan from this" is the primary action, as in frame M5.
- Given a confirmed plan whose gathering has started, when its manage page is requested, then there's no "Call it off".
- Given any plan, when its manage page is rendered, then no email address appears in the HTML and the response carries `noindex`.
- Given a manage token that matches no plan, or a malformed one, when `GET /m/<token>` is requested, then it answers 404, and the malformed one doesn't query the database.

### Story 3.5 (v1): Call a plan off through the manage link

As a creator, I want to call my plan off, even once it's on, so that nobody turns up if plans change.

`POST /m/:token/call-off` (R8) calls the plan off with reason `creator` under the row lock, then signals `calledOff`. On that signal the workflow sends `not_this_time` to the active committers and ends, so no reminder or check-in follows (FR023, FR024). The pages it lands on match frames M4 and M5.

Prerequisites: Story 3.3, 3.4

Acceptance criteria:
- Given an open plan, when the creator calls it off, then the response is 303 to `/m/<manageToken>`, the plan is called off with reason `creator`, a `plan.called_off` event is recorded with `wasConfirmed: false`, and `planWorkflows.signal` is called with `calledOff`.
- Given a confirmed plan whose confirmation emails went out, when the creator calls it off before the gathering, then the event records `wasConfirmed: true`, every active committer gets the "Not this time" email once, and no reminder or check-in is sent afterwards.
- Given a called-off plan, when the call-off is posted again, then nothing is written and the response redirects to `/m/<manageToken>`.
- Given a plan whose gathering has started, when the call-off is posted, then nothing is written and the response redirects to `/m/<manageToken>?notice=too-late`, which shows "It's already started, so it can't be called off." at the top of the content, as in frame M4.
- Given `planWorkflows.signal` fails, when the creator calls the plan off, then the plan is still called off, the response is the usual 303, and the failure is logged at `error`.
- Given a call-off POST that fails the CSRF check, when it's sent, then the response is 403 and the plan isn't called off.

### Story 3.6 (v1): Start a new plan from an old one

As a creator, I want to start a new plan from my old one with a new date, so that retrying takes seconds.

`GET /m/:token/new` (R9) renders the create page in the suggestion-card shape, headed "Same again, new date" (operator, #191), without **Suggest another** or **Change**, pre-filled from the old plan. Publishing goes through `POST /plans` with `fromManageToken`. The new plan gets new tokens and a new workflow, the creator is its only committer, and the old committers aren't emailed (FR025). The page matches frames N1 and N2, except that their heading still reads "Suggest a plan".

Prerequisites: Story 3.4

Acceptance criteria:
- Given a called-off example plan, when `GET /m/<manageToken>/new` is requested, then the page's `h1` is "Same again, new date", and the card shows "Coffee", "Blue Bottle" and minimum 3, the summary "Oakland · Rockridge · next weekend, morning" read-only, date and time empty and editable, Decide by empty, Ana's name and email filled in, and no **Suggest another** or **Change**, as in frame N1.
- Given that form with the date 2026-11-21 and time 10:00, when it's published, then a new plan is stored with new tokens, `from_plan_id` set to the old plan, a `plan.published` event with `fromPlanId`, Ana as its only committer, the old plan unchanged, and `planWorkflows.start` called for the new plan.
- Given the new plan is published, when the emails are read, then Ana gets one manage-link email for the new plan and none of the old plan's committers is emailed.
- Given an open, confirmed or called-off plan, when its new-plan page is requested, then it renders.
- Given a `fromManageToken` that matches no plan, when the form is published, then the plan is published with no `from_plan_id`.
- Given both `suggestionId` and a valid `fromManageToken`, when the form is published, then `from_plan_id` is set and `suggestion_id` is null.
- Given that form with no date, when it's published, then the response is 422 with the new-plan page re-rendered under the heading "Same again, new date", "Pick a date." shown under the date field, and the pre-filled values kept, as in frame N2.

### Story 3.7 (v1): The new look on the built screens

As a committer or a creator, I want every calvin page to look like the same app, so that a plan passed round a group chat feels made with care.

Built before Story 3.4 (operator, #191). `public/app.css` is rewritten to ux-spec §4, as updated for calvin-4, taking its tokens and component rules from the `.app` block of [ux/epic-3.html](./ux/epic-3.html): the wordmark, the state pills, the venue and the when and where lines, the seat row and its tokens, the buttons (primary, secondary, dim and quiet), the link box, notices, the inline confirm and the card. The token names change, so the file is rewritten, not patched. The built pages (create, ready to share, public, withdraw, and the not-found and error pages) change their markup only as far as the frames need: frames B1–B5 list every change under "What changes". No copy, route, status code or behaviour changes, and every page still works without JS. Screens Epic 3 adds (the manage page and the called-off states) use these classes in their own stories. A look at the built screens on a real phone, in light and dark, against frames B1–B5 is an operator check after the merge.

Prerequisites: None

Acceptance criteria:
- Given `public/app.css`, when it's read, then it defines every token in ux-spec §4.1 with its light value on `:root` and its dark value under `@media (prefers-color-scheme: dark)`, and neither the old accent `#B4502B` nor the old background `#FBF7F2` appears in it.
- Given `public/app.css`, when it's measured, then it's at most 10,240 bytes, it has no `@font-face` and no `@import`, and every `animation` or `transition` in it sits inside `@media (prefers-reduced-motion: no-preference)`.
- Given each of the create page, the ready-to-share page, the public page, the withdraw page and the not-found page, when it's rendered, then it shows the wordmark "calvin" with class `brand` before its `h1`.
- Given the example plan with Ana and Mia in, when its public page is rendered, then the pill reads "Needs 1 more" with class `state-open`, the venue "Blue Bottle" is the `h1` with class `venue`, the time and the city are on separate lines with classes `when` and `where`, and the list `<ul aria-label="2 of 3 people in">` has a seat for "Ana" and one for "Mia", each with an `aria-hidden` token showing the initial, and one empty seat labelled "you?" with class `seat-you`, as in frame B3.
- Given a confirmed plan, when its public page is rendered, then the pill reads "It's on" with class `state-on` and the seat list has class `seats-on`, as in frame B4; and given its gathering has started, the pill reads "Happening now" with class `state-now`.
- Given a public page requested with a notice (`notice=on`), when it's rendered, then the notice, with `role="status"`, comes before the pill and the `h1`, not after the seats.
- Given the ready-to-share page, when it's rendered, then the public link is a read-only input inside an element with class `linkbox` with **Copy** inside it, the Share button has class `btn-secondary`, and "Manage your plan" is a link with class `quiet`, as in frame B2.
- Given the route and view tests that existed before this story, when the suite runs, then they pass, and no assertion on user-facing copy was changed to make them pass.
