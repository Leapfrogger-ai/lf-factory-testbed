# Epics: calvin-5

Maturity: **poc**. Stories use the terms in the glossary (plan, creator, commit, committer, withdraw, minimum, count, commit deadline, confirmed, called off, gathering, check-in). Every criterion is checked by a test at a seam the test strategy names, unless it says "checked by hand". In that case the story's plan records how it was checked. A check that needs something a story session doesn't have (a phone, the Temporal CLI, a deploy) isn't a criterion: the story's text names it as a check the operator makes by hand after the merge. Test command `npx vitest run`, type check `npx tsc --noEmit`, and the setup command is the one in the factory config.

Every time is in `America/Los_Angeles`. The example plan used throughout is coffee at Blue Bottle, Oakland (rough area "Rockridge", rough time "next weekend, morning"), on Sat 14 Nov 2026 at 10:00 AM PST (`2026-11-14T18:00:00Z`), minimum 3, created by Ana Ruiz and published at Mon 9 Nov 2026 10:00 AM, so its commit deadline is Wed 11 Nov 2026 10:00 PM (`2026-11-12T06:00:00Z`). Its check-in time is Sun 15 Nov 2026 10:00 AM (`2026-11-15T18:00:00Z`).

**Carried on as calvin-5 (operator, 2026-11-09; lf-factory ADR 0015).** calvin to calvin-4 merged all of Epics 1, 2 and 3. This initiative builds Epic 4: the check-in and the trial data (FR027–FR029), plus the open concerns calvin-4 left in the plan workflow (Stories 4.1 to 4.4). A prerequisite already merged is written as None. Epics 1 to 3 are left out of this file; the PRD and the other documents still describe them.

**Decided in this stage (operator, 2026-11-09):**
1. The check-in email's body is the text in Story 4.5.
2. A reminder that hasn't gone out by the time the gathering starts is dropped, never sent late.
3. No mockup sheet for Epic 4. The check-in thank-you page uses the built withdraw page's layout and classes in the current look (ux-spec §4); the email is text only.
4. NFR010 (a hosted deploy under about $20/month) is left out of Epic 4. It's operator work after the epic.

**Order.** Stories 4.2 to 4.5 all change the plan workflow, so each one waits for the one before it. Story 4.1 goes first, so each later `patched()` id is checked against its own replay test.

## Epic 4: Check-in and trial data

The operator can measure the success test from stored events and check-in answers, and the plan workflow's emails hold up under failed sends, retries and a lost signal. It covers FR027–FR029, and NFR008 for the check-in email.

### Story 4.1 (v1): Every patched() id has its own replay test

As the operator, I want each workflow patch to have its own replay test, so that a change that breaks an old history can't hide behind another patch's test.

The source guardrail that checks `patched()` ids today compares counts: the number of `runReplayHistory` calls in the workflow tests against the number of distinct `patched()` ids in the plan workflow. It changes to match by id. Each id must appear in a workflow test that calls `runReplayHistory`, either in the test's name or in the name of the recorded history fixture it replays. The three ids on main (`confirmed-emails-3-2`, `reminders-3-3`, `call-off-3-5`) each get a replay test that names them, adding replay tests where one is missing. Workflow behaviour doesn't change.

Prerequisites: None

Acceptance criteria:
- Given the plan workflow on main, when the guardrail runs, then it passes, and each of `confirmed-emails-3-2`, `reminders-3-3` and `call-off-3-5` is named by a workflow test that calls `runReplayHistory`.
- Given a `patched('example-x')` call added to the plan workflow with no replay test naming `example-x`, when the guardrail runs, then it fails and its message names `example-x`.
- Given two replay tests that both name `reminders-3-3` and none naming `call-off-3-5`, when the guardrail runs, then it fails and names `call-off-3-5`.
- Given the replay test for each id, when it runs, then it replays a history recorded before that patch without a nondeterminism error.

### Story 4.2 (v1): One failed send doesn't stop the others

As a committer, I want my email to go out even when someone else's address is bad, so that one typo doesn't cost the whole group their reminders.

When a send to one committer fails with a non-retryable error (for example Resend refusing the address), that committer is skipped: the failure is logged at `error` with the plan id, the email kind and the error name (never the address or a token), their ledger row stays unsent, and the remaining committers still get theirs. The activity doesn't fail for it, so the plan workflow carries on to its next email. A retryable failure is still retried as today, and nobody already sent to is sent to again. This holds for every email the workflow sends to several committers (`confirmed`, both reminders and `not_this_time`) and for a late commit's `confirmed` email.

Prerequisites: Story 4.1

Acceptance criteria:
- Given the example plan with Ana, Mia and Raj in, where any send to Mia fails non-retryably, when the plan is confirmed, then Ana and Raj each get one confirmation email, Mia's ledger row for `confirmed` has no sent time, and an `error` line names the plan id, `confirmed` and the error name, with no email address or token in the log.
- Given that plan, when its workflow reaches the 24h and morning reminders, then Ana and Raj get both reminders and the workflow is still running afterwards.
- Given a send to Mia that fails retryably once and then succeeds, when the plan is confirmed, then each of Ana, Mia and Raj gets exactly one confirmation email.
- Given a late commit by Lee whose send fails non-retryably, when Lee's commit is signalled, then the workflow keeps running and the next reminder still goes to everyone else.
- Given an open plan called off at the deadline, where the send to Mia fails non-retryably, when "Not this time" goes out, then every other active committer gets it once.

### Story 4.3 (v1): Reminders that arrive in time and in order

As a committer, I want reminders only before the gathering, and never before my "It's on", so that the emails make sense.

A reminder that hasn't gone out by the gathering's start is dropped: a reminder send that's still retrying when the gathering starts stops, and nobody gets it afterwards (operator, 2026-11-09). Someone who commits while a reminder is being sent or retried gets their "It's on" email first; a reminder reaches a committer only after their `confirmed` email went out. Who's named in a reminder's "Who's in" line is unchanged: the active committers at that moment.

Prerequisites: Story 4.2

Acceptance criteria:
- Given the example plan, where every morning reminder send fails until Sat 14 Nov 2026 10:30 AM, when the send would then succeed, then no morning reminder is sent to anyone, and the workflow is still running and goes on to its check-in time.
- Given the example plan, where the morning reminder goes out to Ana at 8:00 AM but the send to Raj fails until 10:05 AM, when 10:05 AM comes, then Raj gets no morning reminder and Ana got exactly one.
- Given the example plan with its 24h reminder send failing from 10:00 AM to 10:20 AM on Fri 13 Nov, when Lee commits at 10:10 AM, then Lee's first email from the plan is "It's on: Coffee at Blue Bottle, Sat 14 Nov 10:00 AM", and any "Tomorrow:" email to Lee comes after it.
- Given the example plan with no failures, when its workflow runs, then the reminders go at the same instants as before (`2026-11-13T18:00:00Z` and `2026-11-14T16:00:00Z`) with the same text.

### Story 4.4 (v1): A call-off always sends "Not this time"

As a committer, I want to hear when a plan is called off even if something failed along the way, so that I don't turn up to a plan that isn't happening.

Today the call-off route stores the call-off, then signals `calledOff`; if that signal fails it's only logged, and a confirmed plan's workflow goes on to send reminders for a plan that's called off. The database is the source of truth: before each reminder and before the check-in, the workflow learns whether the plan was called off, even when no signal arrived. If it was, it sends `not_this_time` to the active committers once and ends. The route also makes up to 3 attempts at the signal before logging the failure. An open plan whose signal failed is still caught at the deadline, as today.

Prerequisites: Story 4.3

Acceptance criteria:
- Given the example plan, confirmed, where the creator calls it off on Thu 12 Nov and every `calledOff` signal fails, when the workflow reaches the 24h reminder time, then every active committer gets "Not this time: Coffee on Sat 14 Nov" once, nobody gets a reminder, and the workflow ends.
- Given that plan, when the check-in time comes, then Ana gets no check-in email.
- Given a `calledOff` signal that fails twice and then succeeds, when the creator calls the plan off, then the workflow receives it, "Not this time" goes out once to each active committer, and no `error` line is logged.
- Given a `calledOff` signal that fails every time, when the creator calls the plan off, then the response is still 303 to `/m/<manageToken>`, the plan is called off, and one `error` line "plan signal failed" names the plan id and `calledOff`.
- Given a confirmed plan called off whose signal did arrive, when the workflow runs, then "Not this time" still goes out exactly once to each active committer.

### Story 4.5 (v1): The check-in email

As the operator, I want the creator of a confirmed plan asked whether it happened, so that I can measure the success test.

At the check-in time (10:00 the day after the gathering), the plan workflow sends `check_in` to the creator only, once, through the send ledger, and then ends (FR027). The workflow's placeholder wait for the check-in becomes this send. Plans called off get no check-in, including a plan called off after it was confirmed. The subject is "Did it happen? Coffee on Sat 14 Nov". The body, for Ana in the example plan, is exactly:

```
Hi Ana,

Coffee at Blue Bottle was yesterday. Two quick taps, please.

Did it happen?
Yes: BASE_URL/c/<checkInToken>/happened/yes
No: BASE_URL/c/<checkInToken>/happened/no

Were you there?
Yes: BASE_URL/c/<checkInToken>/attended/yes
No: BASE_URL/c/<checkInToken>/attended/no

Thanks!
```

It has no withdraw line.

Prerequisites: Story 4.4

Acceptance criteria:
- Given the example plan, confirmed, when its workflow reaches `2026-11-15T18:00:00Z`, then Ana gets one email with subject "Did it happen? Coffee on Sat 14 Nov" and the body above with her plan's check-in token, an `email.sent` event is recorded with kind `check_in`, nobody else gets a check-in email, and the workflow completes.
- Given the check-in email, when its text is read, then it has no `/w/` URL and no other committer's name.
- Given a plan called off at its deadline, when the day after its gathering comes, then no check-in email is sent.
- Given the first check-in send fails retryably, when it's retried, then Ana still gets exactly one check-in email.
- Given a committer who commits after the 24h reminder and before the gathering, when the check-in time comes, then only Ana gets the check-in.
- Given a history recorded by calvin-4's workflow (placeholder wait at the check-in time), when it's replayed, then it replays without a nondeterminism error.

### Story 4.6 (v1): Answer the check-in

As a creator, I want to answer the check-in with one tap, and change my answer if I tapped wrong, so that it takes no effort.

`GET /c/:token/:question/:answer` is the API specification's R12: `:question` is `happened` or `attended`, `:answer` is `yes` or `no`. It upserts the creator's answer for that question (answering again replaces it, FR028) and records a `check_in.answered` event, in one transaction, then renders the thank-you page with R12's copy. If the other question has no answer yet, the page shows it with **Yes** and **No** links, so one email takes two taps (UX §6.4). Any other value, a token miss, or a plan that isn't confirmed renders the shared not-found page with 404. The page uses the built withdraw page's layout and classes, sets `noindex` and generic OG tags, and shows no plan details beyond the venue.

Prerequisites: Story 4.5

Acceptance criteria:
- Given the example plan, confirmed, when `GET /c/<checkInToken>/happened/yes` is requested, then the response is 200 with "Thanks! Got it: it happened.", `check_in_answers` holds `happened = true` for the plan, one `check_in.answered` event is recorded, and the page shows "Were you there?" with a **Yes** link to `/c/<checkInToken>/attended/yes` and a **No** link to `/c/<checkInToken>/attended/no`.
- Given `happened` was answered yes, when `GET /c/<checkInToken>/happened/no` is requested, then the stored answer becomes `false`, a second `check_in.answered` event is recorded, and the page reads "Thanks! Got it: it didn't happen."
- Given both questions are answered, when `GET /c/<checkInToken>/attended/no` is requested, then the page reads "Thanks! Got it: you weren't there." and shows no other question.
- Given `attended/yes` is the first answer, when it's requested, then the page reads "Thanks! Got it: you were there." and shows "Did it happen?" with its two links.
- Given a called-off plan's check-in token, an unknown token, a malformed token, the question `maybe` or the answer `perhaps`, when the link is requested, then each gets the same not-found page with 404 and nothing is written.
- Given any thank-you page, when its HTML is read, then it carries `noindex`, generic OG tags, and no email address or other committer's name.

### Story 4.7 (v1): The trial metrics run

As the operator, I want the trial metric queries proven against the real schema, so that I can measure the trials on day one without debugging SQL.

The database schema document's "Trial metric queries" section is the operator's way to measure the trials (FR029, no operator UI). A test runs each of those queries, as the document writes them, against the test database seeded through the app's own code paths (publish, commit, withdraw, confirm, call off, send emails, answer the check-in), and checks the results. A query that fails against the real schema is fixed in the document and in the test together. Where an event or column that FR029 names isn't written by the app, the story writes it.

Prerequisites: Story 4.6

Acceptance criteria:
- Given two published plans, one with a commit from someone other than the creator and one with only the creator, when the share-rate query runs, then it returns 0.5.
- Given the example plan, confirmed, with Ana's check-in answered `happened = yes` and `attended = no`, and a second plan called off at its deadline, when the outcomes query runs, then the first row shows state `confirmed`, `was_confirmed` true, the count, the minimum, `happened` 1 and `creator_attended` 0, and the second shows state `called_off` with reason `deadline` and no answers.
- Given a plan published from a suggestion without changes and one published after changing the venue, when the edited-rate query runs, then it returns 0.5.
- Given the emails those plans sent, when the emails-per-kind query runs, then each kind's count matches the emails the test sent.
- Given every query in that section, when the test runs them, then none fails.
- Given a plan's life from publish to check-in answer, when its events are listed, then there's one event for each of `plan.published`, `commit.added`, `plan.confirmed`, `email.sent` and `check_in.answered`, each with a timestamp.
