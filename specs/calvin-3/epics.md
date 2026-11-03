# Epics: calvin-3

Maturity: **poc**. Stories use the terms in the glossary (plan, creator, commit, committer, withdraw, minimum, count, commit deadline, confirmed, called off, gathering, check-in). Every criterion is checked by a test at a seam the test strategy names, unless it says "checked by hand". In that case the story's plan records how it was checked. A check that needs something a story session doesn't have (a phone, the Temporal CLI, a deploy) isn't a criterion: the story's text names it as a check the operator makes by hand after the merge. Test command `npx vitest run`, type check `npx tsc --noEmit`, and the setup command is the one in the factory config.

Every time is in `America/Los_Angeles`. The example plan used throughout is coffee at Blue Bottle, Oakland (rough area "Rockridge", rough time "next weekend, morning"), on Sat 14 Nov 2026 at 10:00 AM PST (`2026-11-14T18:00:00Z`), minimum 3, created by Ana Ruiz and published at Mon 9 Nov 2026 10:00 AM, so its commit deadline is Wed 11 Nov 2026 10:00 PM (`2026-11-12T06:00:00Z`).

**Decided in this stage: the default commit deadline floors at halfway.** FR007's default was the earlier of 48h before the gathering and halfway between publishing and the gathering. For a gathering less than 48h away, that default is in the past, and publishing would be refused. The operator's decision: use the earlier of the two when it's in the future, otherwise use halfway. The rule is still rounded down to the whole minute. PRD FR007 and the API specification's R3 deadline rule are updated to match.

**Carried on as calvin-3 (operator, 2026-11-03; lf-factory ADR 0015).** calvin and calvin-2 merged all of Epic 1. This initiative builds Epic 2: Stories 2.1, 2.2 and 2.3, as shaped (calvin's `epics.md` at commit c989191). A prerequisite already merged is written as None. Epics 1, 3 and 4 are left out of this file; the PRD and the other documents still describe them.

## Epic 2: Commit on the public page

Invitees commit and withdraw without an account, and the public page shows the count against the minimum and committers' first names. It covers FR011–FR018, NFR002, NFR004 and NFR006.

### Story 2.1 (v1): Commit to an open plan

As an invitee, I want to say "I'm in" with my name and email, so that committing takes seconds.

The public page gains the commit form (name with `autocomplete="name"` and `autocapitalize="words"`, email with `type="email"` and `inputmode="email"` and the help "Only used to tell you if it's on. Never shown to anyone.", and **I'm in**). `POST /p/:token/commit` (the API specification's R6) locks the plan row, refuses closed plans (FR015), upserts on the plan and lowercased email (FR013), records `commit.added`, and redirects 303 with a notice that replaces the form. No email address goes into any page, redirect or log line (NFR006).

Prerequisites: None

Acceptance criteria:
- Given the example plan with only Ana in, when Mia Chen commits with `mia@example.test`, then the response is 303 to `/p/<publicToken>?notice=in&n=Mia`, that page shows "You're in, Mia. We'll email you if it's on." instead of the form, the seat row shows "Ana", "Mia" and one "you?" seat, and the pill reads "Needs 1 more".
- Given Mia has committed, when she commits again with `MIA@Example.test` and the name "Mimi Chen", then the response redirects with `notice=updated`, the page shows "Updated: you're in as Mimi.", and the count stays 2.
- Given a new commit and a repeat commit, when the events are read, then each recorded `commit.added` with `change` `new` and `repeat` respectively and the active count after it.
- Given an empty name or the email "mia@", when the commit form is submitted, then the response is 422 with the public page re-rendered, "Add your name." or "That email doesn't look right." under the field, and the entered values kept.
- Given an open plan whose commit deadline has passed, when someone commits, then the response is 303 to `/p/<publicToken>?notice=closed`, the page shows "This one isn't taking commits any more.", and no commit or event is stored.
- Given a plan whose gathering has started, when someone commits, then the response redirects with `notice=closed` and nothing is stored.
- Given a commit, when its redirect URL, the page it leads to and the request's log line are read, then none of them contains the committer's email address, and the log line doesn't contain the public token.
- Given the public page with the form, when its HTML is read, then it still has no `<script>` element and one stylesheet.

### Story 2.2 (v1): A plan is confirmed when it reaches its minimum

As a creator, I want the plan to be on as soon as enough people commit, so that everyone knows it's happening.

The commit that brings the count to the minimum before the commit deadline confirms the plan in the same transaction (FR018) and records `plan.confirmed`. After the transaction, the route signals the plan's workflow. Signals are fire-and-forget: a failure is logged at `error` and the commit stands (ADR 0002). Commits stay open on a confirmed plan until the gathering starts (FR014). The confirmation email itself is Story 3.2.

Prerequisites: Story 2.1

Acceptance criteria:
- Given the example plan with Ana and Raj in before its deadline, when Mia commits, then the plan is confirmed, a `plan.confirmed` event is recorded, the response redirects with `notice=on`, the page shows "You're in, Mia. It's on! We've emailed you the details and we'll remind you the day before.", and `planWorkflows.signal` is called once with `confirmed`.
- Given a confirmed plan before its gathering, when its public page is requested, then the pill reads "It's on", every seat is filled with no empty seats, the page reads "More people are welcome until it starts.", the form is shown, and `og:description` ends with " It's on.".
- Given a confirmed plan after its commit deadline and before its gathering, when a new person commits, then the commit is stored, the response redirects with `notice=on`, and `planWorkflows.signal` is called with `committed` and the new commit's ID.
- Given a confirmed plan, when an existing committer commits again, then no signal is sent.
- Given `planWorkflows.signal` fails, when the confirming commit is submitted, then the plan is still confirmed, the response is the usual 303, and the failure is logged at `error`.
- Given a plan one commit short of its minimum, when two people commit at the same time, then the plan is confirmed once, with one `plan.confirmed` event and one `confirmed` signal.
- Given a confirmed plan whose gathering started less than 3 hours ago, when its public page is requested, then the pill reads "Happening now" and there's no form.
- Given a confirmed plan whose gathering started 3 hours ago or more, when its public page is requested, then the pill reads "This was on Sat 14 Nov" and there's no form.

### Story 2.3 (v1): Withdraw a commit

As a committer, I want to take back my commit from a link in my email, so that I can change my mind without fuss.

The withdraw page (R10) and the withdraw POST (R11) use the commit's withdraw token. The GET only shows a confirm page, so email link scanners can't withdraw anyone. Withdrawing lowers the count, never undoes a confirmed plan (FR017), and sends no signal. The creator can't withdraw. The withdraw link itself appears in the committer emails from Epic 3.

Prerequisites: Story 2.2

Acceptance criteria:
- Given Mia's commit to the example plan, when `GET /w/<withdrawToken>` is requested, then it shows "Withdraw from Coffee at Blue Bottle on Sat 14 Nov?" with a **Withdraw** button, carries `noindex`, and changes nothing.
- Given Mia's withdraw page, when **Withdraw** is submitted, then the response is 303 to `/w/<withdrawToken>?done=1`, the page reads "You're out. You've withdrawn from Coffee on Sat 14 Nov. No more emails about it.", the count drops by one, and a `commit.withdrawn` event is recorded with the new active count.
- Given a confirmed plan at exactly its minimum, when a committer withdraws, then the plan stays confirmed.
- Given Mia has already withdrawn, when **Withdraw** is submitted again, then nothing is written and the response redirects to the done page.
- Given Mia has withdrawn, when she commits again with the same email, then the commit is active again with `change: "rejoined"`, the count rises by one, and her withdraw page shows the confirm view again.
- Given Mia rejoins a confirmed plan before its gathering, when she commits, then `planWorkflows.signal` is called with `committed` and her commit's ID.
- Given the creator's withdraw token, when `GET` or `POST /w/<token>` is requested, then it answers 404 with the not-found page.
- Given a plan whose gathering has started, when its withdraw page is requested, then it reads "This one has already started." with no button, and a POST writes nothing.
- Given a malformed withdraw token, when `GET /w/<token>` is requested, then it answers 404 without a database query.
