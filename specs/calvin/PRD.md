# calvin - Product Requirements Document

**Author**: rodolfo@leapfrogger.ai
**Date**: 2026-10-26
**Maturity**: poc
**Version**: 1.0

---

## Goals

- Test the bet: of 3–5 real "we should" moments tried with calvin, at least 2 lead to a gathering within 30 days that includes the person who said it.
- At least 80% of created plans get shared in a real chat, measured as a plan with at least one commit from someone other than the creator.
- A creator goes from a city, area and time window to a shareable plan link in under 2 minutes.
- The whole plan lifecycle works end to end: suggested, published, committed, then confirmed (with reminders) or called off.

---

## Background Context

Friendly acquaintances, such as neighbors or alumni in the same city, keep saying "we should get together", and nothing happens. Organizing puts the effort and the social risk on one person: they need venue and timing knowledge they lack, and proposing in public exposes them to a visible flop. The group's chat already exists but is used for favors, not plans.

calvin is a link-based web page with no accounts. The **creator** gets a concrete, low-stakes **plan** suggested by an LLM, pastes its link into the group's chat, and the plan only goes ahead once enough people **commit** by the **commit deadline**. If it doesn't, it's **called off** quietly. Evidence so far is one interview (N=1); the PoC is how the bet gets tested. Full context is in [brief.md](./brief.md), and the terms are defined in [GLOSSARY.md](../../GLOSSARY.md).

---

## Functional Requirements

All times are in the local time zone of the plan's city.

### Plan creation and publishing

| ID | Requirement | Priority |
|----|-------------|----------|
| FR001 | The create screen takes a city chosen from a fixed, configured list of San Francisco Bay Area cities (such as San Francisco, Oakland, Berkeley, Palo Alto, San Jose), a free-text rough area and a free-text rough time window. Every city in the list uses the America/Los_Angeles time zone. | Must |
| FR002 | From those inputs, calvin uses Claude to return one suggestion: a format, a venue, a date and time, and a minimum. The format is low-stakes (coffee, drinks, a walk) and never hosting at someone's home. | Must |
| FR003 | A "suggest another" button replaces the current suggestion with a new one from the same inputs. | Must |
| FR004 | If the suggestion fails or times out, the creator sees a short error and an empty form for format, venue, and date and time, which they can fill in and publish as normal. | Must |
| FR005 | Before publishing, the creator can edit every field: format, venue, date and time, minimum and commit deadline. | Must |
| FR006 | The minimum defaults to 3, counts the creator, and must be at least 2, with no upper limit. | Must |
| FR007 | The commit deadline defaults to the earlier of 48h before the gathering or halfway between publishing and the gathering. Publishing is refused if the deadline isn't in the future, or isn't before the gathering. | Must |
| FR008 | Publishing asks the creator for a name and an email address and records the creator as the plan's first committer. | Must |
| FR009 | Publishing creates an unguessable public link and an unguessable private manage link. The manage link is shown to the creator and emailed to them. | Must |
| FR010 | A published plan's fields can't be edited. | Must |

### Public plan page and committing

| ID | Requirement | Priority |
|----|-------------|----------|
| FR011 | The public page shows the plan's format, venue, date and time, the commit deadline, the current count against the minimum, committers' first names, and the plan's state. It never shows an email address. | Must |
| FR012 | An invitee commits on the public page with a name and an email address, with no account and no email verification. | Must |
| FR013 | A commit with an email already committed to that plan updates the name and doesn't add to the count. | Must |
| FR014 | Commits stay open until the gathering starts, including after the commit deadline once the plan is confirmed, with no cap on numbers. | Must |
| FR015 | A called-off plan's page says "not this time" and takes no commits. A plan whose deadline has passed unconfirmed, or whose gathering has started, takes no commits. | Must |
| FR016 | Every email to a committer, other than the creator, carries a link to withdraw. Withdrawing removes their commit and lowers the count. | Must |
| FR017 | Withdrawing never undoes a confirmed plan. The creator can't withdraw. | Must |

### Plan lifecycle and emails

| ID | Requirement | Priority |
|----|-------------|----------|
| FR018 | When the count reaches the minimum before the commit deadline, the plan is confirmed straight away. | Must |
| FR019 | When a plan is confirmed, every committer gets a confirmation email. Anyone who commits to a confirmed plan gets it straight away. | Must |
| FR020 | Every committer of a confirmed plan gets a reminder 24h before the gathering, and one at 08:00 on the morning of it. | Must |
| FR021 | The morning reminder is skipped if the gathering starts before 10:00, or if the 24h reminder went out less than 6h earlier. A reminder whose time has passed when it would be scheduled (for example, for a late committer) is skipped. | Must |
| FR022 | When the commit deadline passes with the count below the minimum, the plan is called off. | Must |
| FR023 | Through the manage link, the creator can call off the plan, whether or not it's confirmed, until the gathering starts. | Must |
| FR024 | When a plan is called off, by deadline or by the creator, every committer gets the same short "not this time" email, and no further reminders go out. | Must |
| FR025 | Through the manage link, the creator can start a new plan from the plan. It copies the fields, needs a new date and time (and so a new commit deadline), gets new links, starts with the creator as the only committer, and doesn't email the old committers. | Must |
| FR026 | The manage link shows the plan's state, count and committers' names, alongside its actions. | Must |

### "Did it happen?" check-in and trial data

| ID | Requirement | Priority |
|----|-------------|----------|
| FR027 | At 10:00 the day after a confirmed plan's gathering, the creator gets a check-in email asking "Did it happen?" and "Were you there?", each answered yes or no with one click. Plans called off get no check-in. | Must |
| FR028 | Check-in answers are recorded. Answering again replaces the earlier answer. | Must |
| FR029 | Every plan, commit, withdrawal, state change, suggestion request (including whether the suggestion was edited before publishing) and email sent is stored with a timestamp, so the operator can compute the trial metrics by querying the data store. There's no operator UI. | Must |

---

## Non-Functional Requirements

| ID | Category | Requirement | Target |
|----|----------|-------------|--------|
| NFR001 | Performance | A suggestion returns, or falls back to the empty form, quickly enough to keep create-to-link under 2 minutes | ≤ 15s p95, hard timeout at 20s |
| NFR002 | Performance | The public page loads fast on a phone on mobile data | ≤ 2s to first render on a mid-range phone over 4G |
| NFR003 | Usability | Every page works on a phone | Usable at 360px width with no horizontal scroll |
| NFR004 | Usability | Committing is quick | An invitee commits in under 30 seconds from opening the link |
| NFR005 | Security | Public, manage, withdraw and check-in links can't be guessed or enumerated | ≥ 128 bits of randomness per token |
| NFR006 | Privacy | Committers' email addresses never leave the server, except to send them email | No email address in any page, URL or API response visible to other committers |
| NFR007 | Timeliness | Deadline call-offs and scheduled emails happen on time | Within 5 minutes of their due time |
| NFR008 | Reliability | Each email goes out once | No duplicate confirmation, reminder, call-off or check-in email for the same committer and plan, including across retries and restarts |
| NFR009 | Deliverability | Emails reach the inbox | Sent through Resend, from a domain with SPF and DKIM set up |
| NFR010 | Cost | Running the PoC stays cheap | Free or low-cost hosting, under roughly $20/month all in at trial volume |

---

## User Journeys

### Journey 1: Create and share a plan

**Persona**: Creator, just after a "we should" moment
**Goal**: Have a specific plan in the group's chat within minutes

| Step | User Action | System Response |
|------|-------------|-----------------|
| 1 | Opens calvin, picks a city, types a rough area and time window | Returns one suggestion: format, venue, date and time, minimum 3, default deadline |
| 2 | Taps "suggest another", or edits fields | Replaces the suggestion, or keeps the edits |
| 3 | Publishes with their name and email | Records them as first committer, shows the public link to copy and the manage link, emails the manage link |
| 4 | Pastes the public link into the group's chat | — |

**Alternative Paths**:
- Suggestion fails or times out → empty form, the creator fills it in and publishes.
- Deadline isn't in the future, or isn't before the gathering → publish refused with the reason; the creator adjusts it.

### Journey 2: Commit from the chat

**Persona**: Invitee
**Goal**: Say yes in seconds

| Step | User Action | System Response |
|------|-------------|-----------------|
| 1 | Taps the link in the chat | Shows the plan, the count against the minimum, first names |
| 2 | Enters name and email, commits | Adds them to the count; if this reaches the minimum, confirms the plan and emails every committer |
| 3 | — | Sends reminders 24h before and on the morning, per the skip rules |

**Alternative Paths**:
- Already committed with that email → name updated, count unchanged.
- Plan already confirmed → confirmation email straight away.
- Changes their mind → uses the withdraw link in any email; count drops, a confirmed plan stays confirmed.
- Plan called off, or its deadline passed unconfirmed → page says "not this time", no commit form.

### Journey 3: Plan doesn't reach its minimum

**Persona**: Creator and committers
**Goal**: Nobody turns up to an empty room

| Step | User Action | System Response |
|------|-------------|-----------------|
| 1 | — | Commit deadline passes below the minimum; plan is called off |
| 2 | — | Every committer gets the "not this time" email |
| 3 | Creator opens the manage link, starts a new plan with a new date | Creates a fresh plan with new links, the creator as only committer |

**Alternative Paths**:
- The creator calls the plan off through the manage link, before or after confirmation → same "not this time" email, reminders stop.

### Journey 4: Did it happen?

**Persona**: Creator of a confirmed plan
**Goal**: Tell the operator whether the gathering took place

| Step | User Action | System Response |
|------|-------------|-----------------|
| 1 | — | At 10:00 the day after the gathering, emails the check-in |
| 2 | Clicks yes or no for each question | Records the answers and shows a thank-you |

---

## UX/UI Vision

### UX Principles

1. **Specific, not open-ended**: the creator gets a ready plan to accept, not a blank form to fill in.
2. **Seconds to commit**: invitees arrive from a chat on a phone, so committing is one short form, no account.
3. **No blame**: copy around the minimum and call-offs is quiet and warm ("not this time"), never "failed" or "cancelled". UI copy says "minimum", not "threshold" or "quorum".

### Core Screens

| Screen | Purpose | Key Elements |
|--------|---------|--------------|
| Create | Get and tweak a suggestion | City picker, area and time window fields, suggestion card with editable fields, "suggest another", publish with name and email |
| Published | Hand over the links | Public link with copy button, note that the manage link was emailed |
| Public plan page | Commit | Plan details, count against minimum, first names, commit form or "not this time" |
| Manage page | Creator actions | State, count, names, "call off", "start a new plan from this" |
| Withdraw / check-in confirmations | Close the loop from an email | One-line confirmation |

### Design Constraints

- Phone-first; the public page is opened from a chat app's in-app browser.
- Link previews in chat apps should show the plan's format, venue and date.

---

## Epic List

### Epic 1: Create and publish a plan
**Goal**: A creator turns a city, area and time window into a published plan with a public link and a manage link.
**Estimated Stories**: 6
**Covers**: FR001–FR010, NFR001, NFR003, NFR005, NFR009 (first email: the manage link)
**Delivers**: A shareable public plan link, viewable on a phone.

### Epic 2: Commit on the public page
**Goal**: Invitees commit and withdraw without an account, and the page shows the count and first names.
**Estimated Stories**: 4
**Depends on**: Epic 1
**Covers**: FR011–FR017, NFR002, NFR004, NFR006
**Delivers**: A plan that collects commits from the group's chat.

### Epic 3: Confirm, remind and call off
**Goal**: Plans confirm or get called off on their own and through the manage link, with the right emails at the right times.
**Estimated Stories**: 6
**Depends on**: Epic 2
**Covers**: FR018–FR026, NFR007, NFR008
**Delivers**: The full plan lifecycle end to end.

### Epic 4: Check-in and trial data
**Goal**: The operator can measure the success test from stored events and check-in answers.
**Estimated Stories**: 2
**Depends on**: Epic 3
**Covers**: FR027–FR029, NFR010
**Delivers**: A measurable PoC, ready for the 3–5 trials.

---

## Out of Scope

### Deferred to Future Phases

- Recurrence (offering the next gathering after one happens) - after the PoC.
- Calendar invite (`.ics`) on the confirmation email - after the PoC.
- Operator UI for metrics - querying the data store is enough for 3–5 trials.

### Explicitly Excluded

- Bot inside WhatsApp or SMS - platform access is restricted; the link reaches the same chats.
- Accounts and login - friction on committing, not needed for the bet.
- Venue database or places API - LLM suggestions are enough to test whether a ready plan helps.
- Scheduling polls and availability matching - the plan proposes one time and the minimum decides it.
- Editing a published plan - start a new plan from it instead.
- Email verification - repeat commits are deduplicated by email instead.
- The exclusion problem and the channel problem - separate bets.

### Platform Limitations

- SMS reminders - cost money and need a provider; email only.
- Cities outside the San Francisco Bay Area - the trials run there.

---

## Constraints

- **LLM**: Claude, through the Anthropic API. The architecture stage picks the model.
- **Email**: Resend.
- **Region**: San Francisco Bay Area only, so all plans use America/Los_Angeles.

---

## Open Questions

| Question | Owner | Status |
|----------|-------|--------|
| Which LLM and email provider to use? | Operator | Resolved: Claude for suggestions, Resend for email |
| Which cities go in the configured list? | Operator | Resolved: San Francisco Bay Area cities, including Oakland and Palo Alto; the architecture stage writes the full list |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-10-26 | rodolfo@leapfrogger.ai | Initial PRD from the brief and grilling; metrics via data store, share rate as ≥1 non-creator commit, manual fallback for failed suggestions, city picker; Claude, Resend and the Bay Area settled |

---

## References

- [brief.md](./brief.md)
- [GLOSSARY.md](../../GLOSSARY.md)
