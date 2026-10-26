# Product Requirements Brief: calvin

**Maturity**: poc
**Version**: 1.0
**Date**: 2026-10-26
**Author**: rodolfo@leapfrogger.ai
**Status**: In Review

---

## Executive Summary

calvin turns "we should get together" into a gathering that actually happens. The user's group already has a chat, such as a WhatsApp subgroup or a text thread with a neighbor. Into that chat, someone who isn't a natural organizer drops a link to a **plan** that calvin suggested. The plan is concrete and low-effort: a format, a venue and a time. It only goes ahead once enough people commit, so nobody owns the risk of an empty room. The PoC tests one bet: with a ready plan and a commit threshold, a gathering happens within 30 days of a "we should" moment.

---

## 1. Problem Statement

### 1.1 Current State
Friendly acquaintances, such as neighbors or alumni in the same city, keep saying "we should get together", and nothing happens. The channels to reach each other already exist, but people use them for favors and referrals, not for social plans. Gatherings do happen, but in private, and people get left out by oversight.

### 1.2 Problem Definition
**Who**: An adult with friendly acquaintances in a city who has said "we should get together" more than once without following through, and who doesn't feel like the natural organizer.
**What**: Nobody owns the next gathering. Intent fades, there's no specific plan to propose, and the would-be organizer feels unequipped: no time to host, no knowledge of venues, living too far out, not knowing people's schedules. On top of that comes no-show fear: the more effort a plan takes, the more it hurts if nobody comes.
**Impact**: Acquaintances stay acquaintances. Gatherings happen privately and leave people out, and the group thins out over time.
**Evidence**: One interview (N=1). It showed:
- **Intent with no follow-through.** "We should get together" was said both to alumni and to a neighbor, and nothing happened.
- **The plan problem.** "I didn't have anything specific to offer."
- **The channel problem.** The city subgroup is for professional favors, so social plans don't get posted there.
- **The eligibility problem.** Living outside the city, not knowing good spots, not feeling practiced at hosting.
- **The fear problem.** Not knowing whether people will show up.
- **The exclusion problem.** Being left off a dinner by oversight.

### 1.3 Root Cause
Organizing puts the effort and the social risk on one person. Turning a vague intent into a proposal takes knowledge the would-be organizer lacks (venues, timing). Proposing in public exposes them to a visible flop. Nothing in the existing channels lowers either cost, so the default is to do nothing.

---

## 2. Target Users

### 2.1 Primary: the would-be organizer

| Attribute | Description |
|-----------|-------------|
| **Profile** | An adult with friendly acquaintances (neighbors, alumni) in a city, who has said "we should" more than once. They may live outside the city center, don't know good spots, and aren't practiced at hosting. |
| **Pain severity** | Not yet rated. One interview, with a clear and recurring pattern. |
| **Current solution** | Nothing. The intent fades. The group's existing chat is used for favors, not plans. |

**Job to be done**: When I've just said "we should get together", I want something specific and low-risk to propose, so that a gathering actually happens without my having to host or risk an empty room.

### 2.2 Secondary: the invitee
These are the other members of the group, who see the link in their chat. They need to understand the plan and commit in seconds, with no account and no app.

---

## 3. Proposed Solution

### 3.1 Solution Vision
A link-based web page with no accounts:
1. **Create the plan.** The creator gives the city, a rough area and a rough time window. calvin, using an LLM, suggests a concrete, low-stakes plan: a format such as coffee, drinks or a walk, a venue, a date and time, and a minimum number of people. The creator can tweak it.
2. **Share it.** The creator pastes the plan's link into the chat the group already uses.
3. **Commit.** Invitees open the link and commit with a name and an email address.
4. **Confirm.** When the minimum-yes threshold is reached by the deadline, the plan is confirmed and everyone who committed gets a confirmation email and a reminder before the gathering.
5. **Call off quietly.** If the threshold isn't met, the plan is called off quietly: everyone who committed gets a short "not this time" email, nobody turns up to an empty room, and the creator can retry with a new date.

### 3.2 Value Proposition
**For** people who keep saying "we should get together" **who** don't feel like organizers, **calvin** is a plan link **that** hands them something specific to propose and only goes ahead once enough people commit. **Unlike** posting "anyone up for drinks?" in the group chat, the creator doesn't own the effort or the risk of a flop.

---

## 4. Success Metrics

The PoC is judged against the success test: **within 30 days of a "we should" moment, a gathering actually happens and includes the person who said it.**

| Measure | Target |
|---------|--------|
| Real "we should" moments tried with calvin | 3–5 |
| Moments that lead to a gathering within 30 days that includes the person who said it | ≥ 2 |
| Plans created that get shared in a real chat (leading indicator) | ≥ 80% |
| Trial source | The interviewee's alumni and neighbor moments first, then people they refer |
| Plans that reach their threshold (leading indicator) | Tracked, no target |

---

## 5. PoC Scope

### 5.1 Must Have

| Feature | User Story | Acceptance Criteria |
|---------|------------|---------------------|
| Plan suggestion | As a creator, I want calvin to suggest a concrete plan from my city, area and time window, so that I have something specific to offer. | Given a city, area and time window, calvin returns a format, venue, date and time, and minimum count. The format defaults to low-stakes (coffee, drinks, walk) and never to hosting. The creator can edit any field before publishing. |
| Shareable plan link | As a creator, I want a link I can paste into my existing chat, so that I don't need the group to adopt a new tool. | Publishing a plan yields an unguessable public link and a private manage link for the creator. The public page renders well on a phone. |
| Commit without an account | As an invitee, I want to say yes with only a name and an email, so that committing takes seconds. | Committing on the page records the name and email. The page shows the current count against the minimum. |
| Minimum-yes threshold | As a creator, I want the plan to go ahead only if enough people commit, so that I'm never alone in an empty room. | Each plan has a minimum and a commit deadline. The minimum defaults to 3, counting the creator, and the deadline defaults to 48h before the gathering. The creator can edit both. Reaching the minimum before the deadline marks the plan confirmed. |
| Confirmation and reminder emails | As a committer, I want to be told when the plan is on and reminded before it, so that I actually show up. | When a plan is confirmed, every committer gets a confirmation email. Every committer gets two reminder emails: one 24h before the gathering and one on the morning of it. |
| Quiet call-off | As a committer, I want a plan that misses its minimum to be dropped without fuss, so that nobody is embarrassed. | If the deadline passes below the minimum, the plan is called off and every committer gets a short "not this time" email. The creator can start a new plan from it with a new date. |

### 5.2 Should Have (after the PoC)
- **Recurrence.** After a gathering, offer to create the next one, so that the gathering keeps happening.
- **Calendar invite.** Attach an `.ics` file to the confirmation email.

### 5.3 Won't Have (this PoC)

| Feature | Rationale |
|---------|-----------|
| Bot inside WhatsApp or SMS | Platform access is restricted, and the link-based page reaches the same chats. |
| Accounts and login | They add friction to committing and aren't needed to test the bet. |
| Venue database or places API | LLM suggestions are good enough to test whether a ready plan helps. |
| Scheduling polls and availability matching | The plan proposes one time, and the threshold decides it. |
| Exclusion problem (making sure nobody is left off) | It's a separate bet, deferred. |
| Channel problem (making social plans normal in favor-only chats) | It's a separate bet, deferred. A link in the chat is the only lever this PoC pulls. |
| SMS reminders | They cost money and need a provider. Email is enough for the PoC. |

### 5.4 PoC Success Criteria
- [ ] A creator can go from a city, area and time window to a shareable plan link in under 2 minutes.
- [ ] The whole plan lifecycle works end to end: suggested, published, committed, then either confirmed (with a reminder) or called off.
- [ ] Out of 3–5 real "we should" moments, at least 2 lead to a gathering within 30 days that includes the person who said it.

---

## 6. Constraints

| Constraint | Description | Impact | Mitigation |
|------------|-------------|--------|------------|
| Team | Built by the factory's agents through its story pipeline | Scope must split into small, independently testable stories | Keep the PoC to the six must-haves |
| Timeline | It has to be testable with real groups within weeks | No time for platform integrations | Link-based web page, email only |
| Cost | Minimal hosting cost: cheap or free hosting, an LLM API and transactional email | No paid SMS, no places API | Email reminders, LLM venue suggestions |
| Technical | WhatsApp doesn't allow lightweight bots in groups | Calvin can't live inside the chat | The creator pastes the link in by hand |

---

## 7. Assumptions & Risks

### 7.1 Key Assumptions

| Assumption | Confidence | Validation Method | Risk if Wrong |
|------------|------------|-------------------|---------------|
| The pattern seen in one interview is common among people who aren't natural organizers | L | The 3–5 real trials, plus a few more conversations | calvin solves one person's problem |
| Having a specific plan to offer is what unblocks the would-be organizer | M | Plans get created and shared within days of a "we should" moment | The blocker is elsewhere, such as social courage or time |
| A minimum-yes threshold lowers no-show fear enough for someone to propose | M | Creators share the link, and interviews after the trial | The fear persists, or the threshold reads as cold |
| People will post a plan link in a chat that's normally used for favors | M | The share rate in the trials | The channel problem blocks the whole flow |
| LLM-suggested venues are good enough to act on | M | How often creators accept the venue or tweak it | Creators abandon plans at the suggestion step |
| Invitees will commit with an email and no account | H | The commit rate on shared links | Committing gets low turnout |

### 7.2 Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| The LLM suggests venues that are closed or don't exist | M | M | The creator reviews and edits every field before publishing |
| Emails land in spam | M | H | Use a reputable transactional email provider and tell committers to expect the email |
| The trials take longer than 30 days to set up | M | M | Recruit trial users before the build finishes |

---

## 8. Open Questions

| Question | Owner | Status |
|----------|-------|--------|
| What's the default minimum? | Operator | Resolved: 3, counting the creator, and the creator can edit it |
| What's the default commit deadline? | Operator | Resolved: 48h before the gathering, and the creator can edit it |
| When do reminders go out? | Operator | Resolved: 24h before the gathering and on the morning of it |
| Which LLM and email provider to use? | Architecture stage | Open |
| Who are the 3–5 trial users, and how are they recruited? | Operator | Resolved: the interviewee's own "we should" moments (alumni, neighbor) first, then people they refer |

---

**Document History**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-10-26 | rodolfo@leapfrogger.ai | Initial draft from the operator's problem framing and elicitation |
