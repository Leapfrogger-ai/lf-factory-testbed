# Epics: calvin-6

Maturity: **poc**. Stories use the terms in the glossary (plan, creator, commit, committer, withdraw, minimum, count, commit deadline, confirmed, called off, gathering, check-in). Every criterion is checked by a test at a seam the test strategy names, unless it says "checked by hand". In that case the story's plan records how it was checked. A check that needs something a story session doesn't have (a phone, the Temporal CLI, a deploy) isn't a criterion: the story's text names it as a check the operator makes by hand after the merge. Test command `npx vitest run`, type check `npx tsc --noEmit`, and the setup command is the one in the factory config.

Every time is in `America/Los_Angeles`. The example plan used throughout is coffee at Blue Bottle, Oakland (rough area "Rockridge", rough time "Saturday morning"), on Sat 14 Nov 2026 at 10:00 AM PST (`2026-11-14T18:00:00Z`), minimum 3, created by Ana Ruiz and published at Tue 10 Nov 2026 10:00 AM, so its commit deadline is Thu 12 Nov 2026 10:00 AM (`2026-11-12T18:00:00Z`). Mia Chen and Raj Patel commit to it.

**Carried on as calvin-6 (operator, 2026-11-11; lf-factory ADR 0015).** calvin to calvin-5 merged all of Epics 1 to 4. This initiative builds Epic 5, "Trial-ready polish": it closes the gaps between the app as built and the Epic 5 mockups, so the whole product hangs together before the 3–5 Bay Area trials. A prerequisite already merged is written as None. Epics 1 to 4 are left out of this file; the PRD and the other documents still describe them.

**The visual reference** is the Epic 5 mockup sheet, `ux/epic-5.html` in this folder, approved by the operator on 2026-11-11 (testbed #290). It draws every flow at 360px in light and dark, on the app's live class names. Stories refer to its frames by id (C1, W3, E6 and so on). The sheet is the authority on look and layout; a story's text is the authority on copy, and where the two differ, the story wins.

**Decided in this stage (operator, 2026-11-11):**
1. When the creator calls a plan off, everyone else who was in gets the email in Story 5.5, with the subject "Called off: Coffee on Sat 14 Nov", and the creator gets no email. A plan called off at its deadline keeps "Not this time". This changes FR024 (the PRD records it).
2. The public page of a plan the creator called off says "Ana called this one off. Nothing to do."
3. After "it didn't happen", the check-in still asks "Were you there?".
4. When suggestions are rate-limited, the create page shows the empty card with the rate-limit notice.
5. The "you?" seat stays as built, even for someone who just committed.
6. Every Changes frame on the sheet and the new E6 email are in scope. Recurrence and the calendar invite stay deferred, and NFR010 (the hosted deploy) is operator work after this epic.

**Order.** Every story changes pages, and most change `app.css`, so they run one at a time in order. Story 5.1 lands the shared styles first, so the feature stories build on the new look and don't collide with it (calvin-4's lesson). No story changes the plan workflow; the existing replay tests must keep passing.

## Epic 5: Trial-ready polish

Every flow, from creating a plan to answering the check-in, looks and reads the way the Epic 5 mockups show, including errors and empty states, at 360px. It covers the operator's change to FR024 and NFR003 for every page it touches.

### Story 5.1 (v1): Shared styles and end pages

As anyone who opens calvin, I want every page to look finished and every end page to offer a next step, so that nothing looks broken or leaves me stuck.

`app.css` gains the sheet's proposed additions, each scoped like the existing rules: a disabled `.btn` is dimmed (opacity 0.65) with a progress cursor and keeps its colour on hover; input placeholders use `--muted`; an invalid `select` gets the `--error` border that inputs already get; `.errors` lists have no bullets or indent; and `.lede`, `.context` and `.answers` exist for Stories 5.2 and 5.6, as the sheet's stylesheet defines them. The end pages get a way onward (frames P8, W3, W4, W5, X2):
- The public page of a plan that was on and is over (pill "This was on Sat 14 Nov") ends with a quiet "Suggest a plan" link to `/`.
- The withdrawn page's heading becomes "You're out", followed by the sentence "You've withdrawn from Coffee on Sat 14 Nov. No more emails about it." and a quiet "Suggest a plan" link.
- The "nothing to withdraw from" and "already started" withdraw pages keep their headings and gain the same link.
- The system error page's sentence becomes "That didn't go through on our side. Go back and try again in a minute." Its heading and "Start over" link stay.

After the merge, the operator checks by hand, on a phone at 360px, that these pages match frames P8, W3, W4, W5 and X2 and nothing scrolls sideways. It isn't a criterion, because a story session has no browser.

Prerequisites: None

Acceptance criteria:
- Given `app.css`, when it's read, then it has a `.btn[disabled]` rule with `opacity: .65` (or `0.65`) and `cursor: progress`, an `input::placeholder` rule using `--muted`, a `select[aria-invalid="true"]` rule using `--error`, and rules for `.errors`, `.lede`, `.context` and `.answers`.
- Given the create page's inputs form after a submit with no city, when its HTML is read, then the city `select` has `aria-invalid="true"`.
- Given the example plan, confirmed, at Sat 14 Nov 2026 2:00 PM (after the 3h "happening now" window), when its public page is requested, then the pill reads "This was on Sat 14 Nov", there's no commit form, and a link with text "Suggest a plan" points to `/`.
- Given Raj has withdrawn, when his withdraw page is shown after the POST, then its `h1` is exactly "You're out", the next paragraph is exactly "You've withdrawn from Coffee on Sat 14 Nov. No more emails about it.", and a "Suggest a plan" link points to `/`.
- Given a called-off plan's withdraw token, and separately a withdraw token after the gathering has started, when each withdraw page is requested, then each keeps its current heading and has a "Suggest a plan" link to `/`.
- Given a request that fails with a server error, when the error page renders, then it reads "Something went wrong", then "That didn't go through on our side. Go back and try again in a minute.", then a "Start over" link to `/`.
### Story 5.2 (v1): Creating a plan, first visit to empty card

As a creator using calvin for the first time, I want to be told what it does and shown what to type, so that I get to a plan without guessing.

On the inputs form, a `.lede` paragraph under the heading reads "Say roughly where and when. We'll suggest one specific plan you can share in your chat." (frame C1). The rough-area field's placeholder is "e.g. Rockridge, near the BART" and the rough-time field's is "e.g. Saturday morning". The lede shows on the inputs form only, including with errors, and not on the card. On the empty card shown when no suggestion came back (frame C7), the What field's placeholder is "e.g. coffee, drinks, a walk" and the Where field's is "e.g. Blue Bottle, College Ave", and a help line under the card reads "Leave Decide by empty and we'll pick a sensible time." When a suggestion request is rate-limited, the page shows that same empty card, with the context line, the "Try suggesting again" button and the notice "Lots of suggestions just now. Fill in your own below, or try again in a few minutes." in place of the fallback notice (operator, 2026-11-11). A plan published from it works like any fallback plan. The suggestion card itself is unchanged.

After the merge, the operator checks by hand, on a phone at 360px, that the inputs form and the empty card match frames C1 and C7 and nothing scrolls sideways.

Prerequisites: Story 5.1

Acceptance criteria:
- Given a first visit to `/`, when the page renders, then a `.lede` paragraph with exactly the text above follows the `h1`, and the area and time inputs have the placeholders above.
- Given a suggestion card for the example inputs, when the page renders, then it has no `.lede` paragraph.
- Given a suggestion that fails, when the fallback card renders, then What and Where have the placeholders above, the help line reads exactly "Leave Decide by empty and we'll pick a sensible time.", and the notice is "We couldn't come up with a suggestion just now. Fill in your own below, or try again."
- Given the suggest rate limit is reached, when Ana asks for a suggestion for Oakland, Rockridge, Saturday morning, then the response shows the empty card (What, Where, Date, Time, Minimum 3, Decide by), the context line "Oakland · Rockridge · Saturday morning", the notice "Lots of suggestions just now. Fill in your own below, or try again in a few minutes.", and no suggestion is requested from Claude.
- Given that empty card filled in with coffee at Blue Bottle on the example date, when Ana publishes it with her name and email, then the plan is published as any fallback plan is, and the suggestion-request record shows no suggestion was used.
### Story 5.3 (v1): Sharing and committing

As a creator, I want my private link kept safe even when its email fails, and as an invitee, I want to see how long is left to decide, so that nobody loses their way into the plan.

When the manage-link email couldn't be sent, the published page (frame S2) shows the share link box as now. Below it, a notice reads "We couldn't email you your private link. Copy it now and keep it somewhere safe: it's the only way to manage the plan.", followed by a second link box labelled "Your private link", holding the manage link with its own Copy button (`btn btn-secondary`). It replaces today's "Bookmark the link below" sentence and the "Manage your plan" link. The emailed case is unchanged. The copy script copies whichever box's button was pressed.

On the public page of an open plan (frame P1), the decide-by sentence ends with a relative hint in brackets, worked out from the time of the request: under 1 hour, "(in under an hour)"; under 24 hours, "(in N hours)", rounded down; otherwise by calendar days in the plan's time zone, "(tomorrow)" for 1 and "(in N days)" for more. On the public page of a plan that's on (frame P6), the email help line reads "Only used to send you the details and reminders. Never shown to anyone."; on an open plan it stays "Only used to tell you if it's on. Never shown to anyone."

After the merge, the operator checks by hand, on a phone, that each Copy button on the published page copies the right link.

Prerequisites: Story 5.2

Acceptance criteria:
- Given a publish whose manage-link email fails, when the published page renders, then it has the notice above, a link box labelled "Your private link" whose input holds `BASE_URL/m/<manageToken>` and whose button reads "Copy", and no "Bookmark" text.
- Given a publish whose manage-link email succeeds, when the published page renders, then it's as before: one link box, the "We've emailed you a private link" line and the "Manage your plan" link.
- Given the example plan viewed at Tue 10 Nov 2026 10:00 AM, when its public page renders, then the sentence reads "Goes ahead with a minimum of 3. Decide by Thu 12 Nov, 10:00 AM (in 2 days)."
- Given the example plan viewed at Wed 11 Nov 2026 9:00 AM, at Thu 12 Nov 2026 5:00 AM, and at Thu 12 Nov 2026 9:30 AM, when its public page renders, then the hint reads "(tomorrow)", "(in 5 hours)" and "(in under an hour)" respectively.
- Given the example plan, confirmed, when its public page renders, then the help line under the email field reads exactly "Only used to send you the details and reminders. Never shown to anyone."
### Story 5.4 (v1): Withdrawing, with a way back

As a committer, I want to know what withdrawing does and be able to change my mind, so that I don't leave by accident or feel I've let the group down.

The withdraw confirmation page (frames W1 and W2) keeps its heading and Withdraw button. Under the heading, it adds a sentence: on a plan that's on, "It stays on for everyone else. You'll come off the list, and we won't email you about it again."; otherwise, "You'll come off the list, and we won't email you about it again.". Under the button, a quiet "Stay in" link goes to the plan's public page. The button and the link sit in a `.stack`. The page still shows no names or email addresses, and stays `noindex`.

Prerequisites: Story 5.3

Acceptance criteria:
- Given Raj's withdraw token on the example plan while it needs 1 more, when `GET /w/<withdrawToken>` is requested, then the page shows the heading "Withdraw from Coffee at Blue Bottle on Sat 14 Nov?", the sentence "You'll come off the list, and we won't email you about it again.", a Withdraw button, and a "Stay in" link to `/p/<publicToken>`.
- Given the example plan, confirmed, when Raj's withdraw page is requested, then the sentence reads "It stays on for everyone else. You'll come off the list, and we won't email you about it again."
- Given Raj follows "Stay in", when the public page loads, then he's still in and the count is unchanged.
- Given any withdraw page, when its HTML is read, then it has no email address and no committer's name, and it carries `noindex`.

### Story 5.5 (v1): The creator's call-off, in their own words

As someone who committed, I want to know that the creator called the plan off, so that I know it was their call and there's nothing for me to do. As the creator, I want to see that the others were told, without being emailed about my own call-off.

When the creator calls a plan off, whether it was open or on, each active committer other than the creator gets one email (frame E6), with the subject "Called off: Coffee on Sat 14 Nov" and the body, for the example plan, exactly:

```
Ana called off Coffee at Blue Bottle. Nothing to do.
```

It names the creator by first name. Like "Not this time", it has no count, no other names and no withdraw link. The creator gets no call-off email (operator, 2026-11-11; this changes FR024). A plan called off at its deadline is unchanged: everyone who was in, the creator included, gets "Not this time". The email is still sent once per committer through the send ledger, including when the call-off is found through the database rather than the signal. Choosing the wording when the email is built, from the plan's call-off reason, keeps the plan workflow unchanged, so no new `patched()` id is needed.

On the manage page (frames M2 and M3), the call-off confirmation reads "Call it off? Everyone who's in gets a short email saying you called it off.". After calling it off, the page shows the notice "Called off. We've let the people who were in know." (`role="status"`), or "Called off." when the creator was the only one in. On the public page of a plan the creator called off (frame P10), the line under the plan reads "Ana called this one off. Nothing to do." in place of "This one isn't going ahead. No harm done. Maybe next time."; the pill stays "Not this time". A plan called off at its deadline keeps today's line. The link preview of a called-off plan still says "Not this time".

Prerequisites: Story 5.4

Acceptance criteria:
- Given the example plan with Ana, Mia and Raj in, open, when Ana calls it off through the manage link, then Mia and Raj each get one email with subject "Called off: Coffee on Sat 14 Nov" and exactly the body above, Ana gets no email, and there's an `email.sent` event for each of the two emails sent.
- Given the example plan, confirmed, when Ana calls it off on Thu 12 Nov, then Mia and Raj each get that email once, nobody gets a reminder afterwards, and Ana gets no email.
- Given the example plan with Ana and Mia in at its deadline, when it's called off at the deadline, then Ana and Mia each get "Not this time: Coffee on Sat 14 Nov" with today's body, as before.
- Given a confirmed plan called off by Ana where every `calledOff` signal fails, when the workflow reaches the 24h reminder time, then Mia and Raj each get the "Called off" email once and Ana gets none.
- Given the call-off email, when its text is read, then it has no `/w/` URL, no count and no committer's name other than Ana's.
- Given Ana's manage page before the call-off, when its HTML is read, then the confirmation reads exactly "Call it off? Everyone who's in gets a short email saying you called it off."
- Given Ana has just called off the example plan with Mia in, when the manage page renders after the redirect, then it shows the notice "Called off. We've let the people who were in know." above the "Not this time" pill; and given a plan with only Ana in, then the notice reads "Called off."
- Given the example plan called off by Ana, when its public page renders, then the pill reads "Not this time" and the line reads exactly "Ana called this one off. Nothing to do."; and given a plan called off at its deadline, then the line reads "This one isn't going ahead. No harm done. Maybe next time."
- Given the two paths above (the call-off arriving by signal, and found through the database when every signal fails), when each is tested, then each has its own test showing the creator gets no email of any kind for the call-off.
- Given histories recorded by calvin-5's workflow, when the replay tests run, then they pass unchanged, with no replay test or recorded history edited.

### Story 5.6 (v1): Check-in pages that say which plan

As a creator answering the check-in, I want to see which plan I'm answering about and tap clear Yes and No buttons, so that I answer the right question once and know I can fix a wrong tap.

Every check-in thank-you page (frames K1, K2, K3) opens, under the wordmark, with a `.context` block naming the plan: the format and venue ("Coffee at Blue Bottle") as `.kind`, and the date and time ("Sat 14 Nov · 10:00 AM") as `.when`. The thank-you heading follows it, unchanged. When the other question still has no answer, its Yes and No links sit side by side in `.answers`, Yes as `btn btn-primary` and No as `btn btn-secondary` (today No has only `btn`). "Were you there?" is still asked after "it didn't happen" (operator, 2026-11-11). When both questions are answered, the page ends with the line "Tapped the wrong one? Use the links in the email again; the last tap counts." (`.meta`) and a quiet "Suggest another plan" link to `/`. The pages keep `noindex` and generic OG tags, and show no committer's name or email address.

After the merge, the operator checks by hand, on a phone at 360px, that the check-in pages match frames K1–K3 and nothing scrolls sideways.

Prerequisites: Story 5.5

Acceptance criteria:
- Given the example plan, confirmed, when `GET /c/<checkInToken>/happened/yes` is requested, then the page shows "Coffee at Blue Bottle" and "Sat 14 Nov · 10:00 AM" before the heading "Thanks! Got it: it happened.", then "Were you there?" with a Yes link (`btn btn-primary`) to `/c/<checkInToken>/attended/yes` and a No link (`btn btn-secondary`) to `/c/<checkInToken>/attended/no`, both inside `.answers`.
- Given `happened` was answered no first, when its page renders, then it reads "Thanks! Got it: it didn't happen." and still asks "Were you there?" with both links.
- Given both questions answered, when `GET /c/<checkInToken>/attended/yes` is requested, then the page shows the plan block, "Thanks! Got it: you were there.", the line "Tapped the wrong one? Use the links in the email again; the last tap counts.", a "Suggest another plan" link to `/`, and no Yes or No links.
- Given any check-in page, when its HTML is read, then it carries `noindex` and generic OG tags, and has no email address or committer's name.
- Given `app.css`, when it's read, then `.answers` is a flex row with a gap, `.answers .btn` grows to share the row (`flex: 1`), and `.btn` keeps `min-height: 48px`, so the Yes and No buttons sit side by side at least 48px tall.
