# calvin UX Design Specification

**Created**: 2026-10-26
**Author**: rodolfo@leapfrogger.ai
**Maturity**: poc
**Status**: Review

Visual reference for Epic 5: [ux/epic-5.html](./ux/epic-5.html), approved by the operator on 2026-11-11 (testbed #290). It draws every flow end to end, every state included, at 360px, light and dark, on the app's live `app.css` plus a short block of proposed additions; where it changes a built screen, it says what changes. It's the reference for every screen from Epic 5 on. The earlier reference follows.

Visual reference: [ux/epic-3.html](./ux/epic-3.html), approved by the operator on 2026-11-04 (testbed #191). It draws every built screen in the current look and every Epic 3 screen, at 360px, light and dark, with the CSS this section describes. It replaces [ux/mockups.html](./ux/mockups.html) for the look; the older sheet still shows the screens Epic 4 adds. Terms are as in [GLOSSARY.md](../../GLOSSARY.md); requirement IDs are from [PRD.md](./PRD.md).

---

## 1. Project Context

**Product**: calvin, a link-based web page with no accounts. It turns a "we should" moment into a concrete plan that only goes ahead once its minimum commits.
**Purpose**: Take the effort (what, where, when) and the risk (an empty room) off the person who said "we should".

| Segment | Description | Priority |
|---------|-------------|----------|
| Creator | Not a natural organizer, just had a "we should" moment, wants something specific to propose in under 2 minutes | Primary |
| Invitee | Taps the link in a group chat, on a phone, in the chat app's in-app browser; wants to say yes in seconds | Secondary |

**Platform**: Web, phone-first. The public page mostly opens in WhatsApp's, iMessage's or another chat app's in-app browser. Desktop just gets the same single column, centred.

---

## 2. Core Experience

### 2.1 Defining Interaction
An invitee opens the link in the chat, sees who's in so far against the minimum, and taps **I'm in**. That's the product. The create flow exists to produce that page.

### 2.2 Emotional Goals
- **Low stakes** (creator): it's only a coffee, and it only happens if others want it. Achieved by a ready-made suggestion, the minimum shown as people rather than a target, and no hosting.
- **Easy yes** (invitee): two fields and one button, with no account and no app.
- **No blame** (everyone): a plan that doesn't reach its minimum ends with a quiet "not this time". It uses no red and no "failed" or "cancelled", and never names who didn't come.

### 2.3 Experience Principles

| Principle | Decision |
|-----------|----------|
| Speed | Create-to-link < 2 min (suggestion ≤ 15s p95); commit < 30s |
| Guidance | Opinionated: calvin proposes, the creator accepts or tweaks. No blank form, except the fallback when a suggestion fails |
| Flexibility | Every field is editable before publishing; nothing is editable after (FR010). "Start a new plan from this" covers changes |
| Feedback | Warm and calm. The one moment of celebration is a plan becoming confirmed ("It's on!"), and even that is small |

### 2.4 Inspiration
| App | What it does well | Applied here |
|-----|-------------------|--------------|
| Partiful | Invite page that feels social, not admin | Plan page leads with the plan and the people, not with a form |
| Doodle / Calendly | Zero-account participation from a link | Commit with name + email only |
| Kickstarter's "all or nothing" | Nobody's on the hook unless the minimum is met | The seat dots: the plan is on once the row is full |

### 2.5 Pattern Type
Standard web patterns (forms, a status page). The one novel element is the **seat row** (§7.2), which shows the count against the minimum as named seats.

---

## 3. Design System

**Choice**: Custom, a small hand-written stylesheet with CSS custom properties as tokens, plus semantic HTML. No component library and no CSS framework.

**Rationale**: About six simple screens with no app chrome. The public page has to render in ≤ 2s over 4G inside in-app browsers (NFR002), so it should ship close to zero JS and one small CSS file (target < 10 KB). A component kit would add weight and nothing this UI needs. This doesn't constrain the architecture stage's choice of framework: any server-rendered approach can emit this markup.

**Provided by the platform**: native `<select>`, `<input type="email">`, `<input type="date">` / `type="time"` (native pickers on phones), `<button>`, `<form>`, and the Web Share API where available.

**Custom**: plan card, editable suggestion card, seat row, state pill, link box with copy, inline confirm. See §7.

---

## 4. Visual Foundation

Direction: **warm & casual**, like a note in a friend's handwriting. A soft lilac-grey paper, one berry accent, the venue in the phone's own book serif and everything else in system rounded type. This replaces the first version's terracotta on off-white (operator, 2026-11-04, #191), which had become the most common look of generated pages. Berry stays well clear of the error red, so "Not this time" never reads as a failure.

### 4.1 Color System

All pairs below were checked against WCAG AA in both themes: text ≥ 4.5:1, UI boundaries ≥ 3:1. The CSS is the `.app` block in [ux/epic-3.html](./ux/epic-3.html).

| Token | Light | Dark | Usage | Contrast (light) |
|-------|-------|------|-------|------------------|
| `--paper` | `#F5F3F8` | `#1A1720` | Page background | |
| `--surface` | `#FFFFFF` | `#24202B` | Cards, inputs | |
| `--ink` | `#24202E` | `#F2EFF6` | Primary text | 14.4:1 |
| `--ink-2` | `#4E4760` | `#CBC4D8` | Labels, secondary text, called-off venue | 8.0:1 |
| `--muted` | `#645C75` | `#A79FB5` | Meta lines, help text | 5.7:1 |
| `--line` | `#DDD8E5` | `#3A3445` | Decorative dividers only | n/a |
| `--line-strong` | `#8A8199` | `#7F7792` | Input borders, empty seats | 3.35:1 |
| `--berry` | `#8A2F6F` | `#E59BCB` | Primary buttons, links, filled seats, wordmark, focus ring | 7.0:1 on paper |
| `--berry-press` | `#6F2459` | `#F0B8DB` | Pressed/hover primary | |
| `--berry-tint` | `#F6E3EF` | `#3B2434` | "Needs N more" pill, the "you?" seat | 6.3:1 with `--berry` |
| `--on-accent` | `#FFFFFF` | `#1A1720` | Text on berry, green and ink-2 fills | 7.7:1 on berry |
| `--on` | `#2B6A45` | `#8FCBA5` | Confirmed: pill text, seats, the line joining them, notice | 5.9:1 |
| `--on-tint` | `#E2F0E6` | `#1F3329` | Confirmed pill and notice background | 5.5:1 with `--on` |
| `--off-tint` | `#E8E5ED` | `#332E3C` | "Not this time" pill, neutral notices, the inline confirm | 7.0:1 with `--ink-2` |
| `--error` | `#A8321E` | `#F08B76` | Form validation and the suggestion-failed notice **only** | 6.1:1 |
| `--strip` | `#24202E` | `#F2EFF6` | The manage page's private strip | 14.4:1 with `--strip-text` |
| `--strip-text` | `#F5F3F8` | `#1A1720` | Text on the strip | |

Rules:
- A called-off plan uses neutrals (`--ink-2` on `--off-tint`), **never** `--error`. Red means "fix this field", never "your plan failed".
- Colour is never the only signal: every state is also named in words, and the open and on pills also carry a dot that the off pill doesn't.

**Dark mode**: yes, following `prefers-color-scheme`. It costs only the token overrides above, and in-app browsers inherit the phone's theme.

### 4.2 Typography

- **Sans** (everything except the lines below): `ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- **Serif** (the venue, page titles, the wordmark and the seat initials): `"Iowan Old Style", Charter, "Bitstream Charter", "Palatino Linotype", "Book Antiqua", Georgia, serif`, the phone's own book serif, so the plan reads like something written down.
- **No web font download** for either, so the public page keeps its ≤ 2s budget. No monospace, including the link box.

| Level | Family | Size | Weight | Line height | Usage |
|-------|--------|------|--------|-------------|-------|
| wordmark | serif, italic | 21px | 600 | 1 | "calvin", top of every page |
| venue | serif | 36px | 600 | 1.08 | Venue on the public and manage pages (`h1.venue`) |
| h1 | serif | 24px | 600 | 1.25 | Other page titles |
| h2 | sans | 18px | 600 | 1.3 | Section heads ("You're the first one in") |
| kind | sans | 15px | 600 | 1.5 | "Coffee" above the venue, in sentence case (no uppercase eyebrow) |
| when | sans | 18px | 600 | 1.3 | Date and time, on its own line under the venue |
| body | sans | 16px | 400 | 1.5 | Copy. 16px minimum on inputs (stops iOS zoom-on-focus) |
| meta | sans | 14px | 400 | 1.45 | City line, help text, deadline line |
| label | sans | 14px | 600 | 1.3 | Form labels |
| seat name | sans | 13px | 600 | 1.2 | Name under a seat token |

### 4.3 Spacing

Base unit 4px. Tokens: `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s5` 24, `--s6` 32. Radius: 12px for cards, 10px for inputs, pill (999px) for buttons and state pills.

### 4.4 Layout Grid

None. There's one column, `max-width: 440px`, centred, with 16px side gutters. No horizontal scroll at 360px (NFR003).

---

## 5. Design Direction

| Aspect | Decision |
|--------|----------|
| Navigation | None. Every page is reached from a link (chat or email) and is a dead end by design. The only cross-link is "Suggest a plan" on a called-off page |
| Structure | Single column, top to bottom: state → plan → people → action |
| Organization | One card per plan; the plan itself is the hero, not the form |
| Density | Spacious; few elements per screen, generous 48px controls |
| Weight | Minimal: flat, 1px borders, no shadows, no imagery |
| Brand | The wordmark "calvin" in berry italic serif, top-left of every page, not a link (except on create) |

**Rationale**: invitees arrive cold from a chat. The first screenful must answer *what, where, when, who's in* and show the button, with no scrolling on a 360×640 viewport for an open plan with up to ~5 names.

---

## 6. User Journeys

### 6.1 Create and share a plan (PRD Journey 1)

**Approach**: one page, progressive disclosure. No page change until publishing.

```
Create: inputs ──Suggest a plan──▶ [loading ≤20s] ──▶ Suggestion card + your details ──Publish──▶ Published
                                        │                    │  ▲
                                        │ fail/timeout       │  └─ Suggest another (replaces card)
                                        ▼                    │
                              Fallback: empty fields ────────┘ (same publish section)
```

1. **Inputs** (mockup 1a)
   - Sees: "Let's get something on the calendar", City (`<select>` from the configured list, no default selection), Rough area (text, placeholder "e.g. Rockridge, near the BART"), Rough time (text, placeholder "e.g. next weekend, a weekday evening").
   - Does: fills in all three and taps **Suggest a plan**. All three are required; empty fields show inline errors on submit.
   - System: the button is disabled and a spinner line rotates through "Finding something nearby…" and "Picking a time…". Hard timeout at 20s (NFR001).
2. **Suggestion** (mockup 1b)
   - The inputs collapse to a one-line summary ("Oakland · Rockridge · next weekend, morning", with **Change**) and the suggestion card appears below.
   - Card rows: format (the kind line), **Where**, **When**, **Minimum** ("3 people, you included"), **Decide by** (the commit deadline). Each row has **Edit**, which turns that row into its input in place (format: text; where: text; when: date + time; minimum: number stepper, min 2; decide by: date + time).
   - **Suggest another** (secondary button) replaces the card with a fresh suggestion from the same inputs. Edits to the current card are lost; that's acceptable, since tapping it means "I don't like this one".
   - Changing **When** recomputes **Decide by** to the default (FR007), unless the creator has edited Decide by themselves.
3. **Your details + Publish**, below the card: "You're the first one in", Your name, Your email (help text: "We'll email you a private link to manage the plan."), **Publish plan** (primary).
4. **Published** (mockup 2): see §6.2's entry point.

**Decision points / errors**
- Suggestion fails or times out → mockup 1c: notice "We couldn't come up with a suggestion just now. Fill in your own below, or try again." The same card shows empty, with all rows already in edit mode (What, Where, Date, Time, Minimum = 3, Decide by = computed once a date and time are set), plus a **Try suggesting again** quiet button. Publishing works as normal.
- Publish refused (FR007): inline error under **Decide by**, either "The decide-by time needs to be in the future." or "The decide-by time needs to be before the gathering." Focus moves to that field and nothing else is cleared.
- Invalid email or empty name: inline error under the field, shown on submit.

**Success**: Published screen. "Your plan is ready to share". Public link in a link box with **Copy** (button text changes to "Copied" for 2s). **Share…** (secondary, shown only when `navigator.share` exists) opens the native share sheet with the link and the text "Coffee at Blue Bottle, Sat 9 Nov 10:00 — I'm in, who else?". Meta line: "We've emailed you a private link to manage the plan. Keep it to yourself." Under the meta line, a quiet **Manage your plan** link opens the manage page. That covers FR009's "shown to the creator" without putting a second copyable URL next to the one to paste in the chat.

### 6.2 Commit from the chat (PRD Journey 2)

**Approach**: single page, form inline under the plan.

1. **Open link** (mockup 3a). Sees: state pill, kind line, venue (h1), "City · Day D Mon · HH:MM", seat row, "Goes ahead with a minimum of 3. Decide by Thu 7 Nov, 10:00.", then Your name, Your email (help: "Only used to tell you if it's on. Never shown to anyone."), **I'm in**.
2. **Commit**. A full page POST, then a redirect back to the same page with a notice (works without JS):
   - Plan still open: notice "You're in, Mia. We'll email you if it's on." The seat fills with their name.
   - This commit reached the minimum, or the plan was already confirmed: notice "You're in, Mia. It's on! We've emailed you the details and we'll remind you the day before." (mockup 3b).
   - Same email again (FR013): "Updated: you're in as Mia." The count is unchanged.
3. After committing, the form is replaced by the notice. A returning visitor (no session, no cookie needed) sees the form again; re-committing with the same email just updates the name.

**Decision points**
- Confirmed plan: the pill reads "It's on", filled seats turn `--on` green, extra committers beyond the minimum appear as more filled seats, and the line under them reads "More people are welcome until it starts." The form stays (FR014).
- Called off, or deadline passed unconfirmed (FR015): mockup 3c. Pill "Not this time", venue in `--ink-2`, "This one isn't going ahead. No harm done. Maybe next time." No form, no seat row, no count. A quiet link "Want to try your own? Suggest a plan" goes to Create.
- Gathering has started (confirmed): pill "Happening now" or "This was on Sat 9 Nov". No form; the seats are shown.

**Withdraw** (from any email, FR016): the link opens a page reading "Withdraw from Coffee at Blue Bottle on Sat 9 Nov?" with one button, **Withdraw**. Withdrawal is a POST, not the GET from the link, so email link scanners can't withdraw people. The result (mockup 5): "You're out. You've withdrawn from Coffee on Sat 9 Nov. No more emails about it." If the plan was confirmed, nothing else changes for anyone (FR017).

### 6.3 Plan doesn't reach its minimum (PRD Journey 3)

1. The deadline passes below the minimum → every committer gets the "not this time" email (§8.9) → the public page shows mockup 3c.
2. The creator opens the manage link. The page shows "Not this time" and one primary action, **Start a new plan from this**.
3. **Start a new plan from this** opens the Create page with the suggestion card pre-filled with the old format, venue and minimum, **When** empty and in edit mode, **Decide by** empty, and the creator's name and email pre-filled. Publishing goes to a new Published screen with new links (FR025).

**Creator calls off** (FR023), from the manage page (mockup 4): the **Call it off** quiet button expands an inline confirm in place: "Call it off? Everyone who's in gets a short "not this time" email." with **Keep it** / **Call it off**. There's no modal. After it: the pill becomes "Not this time", and the manage page offers **Start a new plan from this**.

### 6.4 Did it happen? (PRD Journey 4)

The email holds two questions, each with **Yes** / **No** links. Each link records its answer on open (GET is acceptable here: re-answering replaces the answer, FR028, and a prefetch at worst writes a harmless default) and lands on "Thanks! Got it: it happened." There, the other question is shown with its yes/no buttons if it hasn't been answered yet, so one email can be done in two taps without going back to the inbox.

---

## 7. Component Library

### 7.1 From the platform
Native form controls with the token styling: 48px min height, 16px text, `--line-strong` border, 10px radius, 2px `--berry` focus ring with 2px offset.

### 7.2 Custom Components

#### Seat row
**Purpose**: shows the count against the minimum as people, so "2 of 3" reads as "one more friend" rather than a score. It's the app's one bold element.
**Anatomy**: a horizontal, wrapping list. One seat per committer: a 40px round token with their initial in the serif, and their first name under it (first word of the name, at most 16 chars, ellipsised). If the count is below the minimum, empty seats (a dashed outline) fill out the row up to the minimum; on the public page the first empty seat is labelled "you?" and tinted berry. Below the row, the meta line covers the minimum and the deadline.
**States**:
| State | Look |
|-------|------|
| Open, below minimum | Tokens in `--berry`, dashed empty seats in `--line-strong`, the "you?" seat dashed `--berry` on `--berry-tint` |
| Confirmed | Every token in `--on`, joined by a 2px `--on` line, drawn in once, only under `prefers-reduced-motion: no-preference`; no empty seats; more seats wrap onto new lines |
| Called off | Not rendered on the public page |

On the manage page the same tokens sit beside full names in a vertical list (`ul.names`, "Who's in"), with a dashed row for each empty seat; confirmed turns them green (`names-on`), called off turns them grey with no count and no empty seats (`names-off`, "Who was in").
**Accessibility**: `<ul aria-label="2 of 3 people in">`; each seat is an `<li>` with its name; the tokens are `aria-hidden`. Empty seats have no text except "you?".

#### State pill
| Plan state | Copy | Class | Style |
|------------|------|-------|-------|
| Open, below minimum | "Needs N more" | `state-open` | `--berry` on `--berry-tint`, with a dot |
| Confirmed | "It's on" | `state-on` | `--on` on `--on-tint`, with a dot |
| Called off / deadline passed | "Not this time" | `state-off` | `--ink-2` on `--off-tint`, no dot |
| Confirmed, started or past | "Happening now" / "This was on Sat 9 Nov" | `state-now` | `--on` outline, no fill |

On the manage page the open pill appends " · decide by Thu 7 Nov, 10:00".

#### Suggestion card
**Purpose**: a ready plan to accept, with every field one tap from editable.
**Anatomy**: kind line + four label/value rows (Where, When, Minimum, Decide by), each with an **Edit** text button (≥ 44×44 hit area).
**States**: loading (the card is replaced by the spinner line), suggested (read rows), editing a row (that row becomes its input; **Done** collapses it), fallback (all rows in edit mode, empty), validation error (inline under the row).
**Accessibility**: **Edit** buttons have `aria-label="Edit where"` and so on; the opened input receives focus; **Done** returns focus to the row's **Edit**.

#### Link box
A labelled ("Link to share") read-only URL field, ellipsised, with **Copy** as a primary button inside its right end. On copy: the button reads "Copied" for 2s, announced through `aria-live="polite"`. If the clipboard API isn't available, the URL text is selectable. **Share…** sits under it as a secondary button.

#### Inline confirm
Used only for **Call it off**, a native `<details>` whose summary is a quiet link. It expands in place on `--off-tint`: one sentence saying the consequence, then **Keep it** (quiet link back to the page) and **Call it off** (filled `--ink-2`, `btn-dim`, not red). Focus moves to **Keep it**.

---

## 8. UX Patterns

### 8.1 Button Hierarchy
- **Primary**: filled `--berry`, full width, pill, 48px. **One per screen**: Suggest a plan, Publish plan, I'm in, Copy, Withdraw.
- **Secondary**: `--berry` 1.5px outline, full width: Suggest another, Share…, Start a new plan from this.
- **Quiet**: underlined `--ink-2` text, 44px hit area: Try suggesting again, Change, Edit, Keep it, Call it off (before expanding), Manage your plan.
- **Dim**: filled `--ink-2`, `--on-accent` text: only **Call it off** inside the inline confirm.
- **Destructive**: there's no red. Calling off a plan is a quiet action with an inline confirm.

### 8.2 Feedback
| Type | Pattern |
|------|---------|
| Success | Inline notice at the top of the content (`role="status"`); `--on-tint` for "It's on", neutral otherwise. No toasts |
| Error (field) | `--error` text under the field, shown on submit, cleared when the field changes; focus moves to the first invalid field |
| Error (system) | Outlined `--error` notice at the top with a plain sentence and a way forward; never a dead end |
| Loading | The button is disabled, plus a one-line spinner with friendly text. Only the suggestion waits noticeably |

### 8.3 Forms
- Labels above the fields, always visible; placeholders are only examples, never labels.
- Validation on submit, then live for the field being fixed.
- `autocomplete="name"` / `"email"`, `type="email"`, `inputmode="email"`, `autocapitalize="words"` on the name field.
- Forms work as plain HTML POSTs; JS only adds polish (the suggestion fetch, copy, share).

### 8.4 Modals
None. Browser `alert`/`confirm` are also off-limits (they're unreliable in in-app browsers).

### 8.5 Navigation
Each page stands alone. The browser back button must never resubmit a form (POST → redirect → GET). No breadcrumbs, no menu.

### 8.6 Empty states
- Create: there's no first-use state; the screen *is* the first use.
- A plan with only the creator in: seat row "● Ana ○ you? ○", with the pill "Needs 2 more".
- Unknown or garbage token on any link: "We can't find that plan. The link may be incomplete. Check it in your chat or email." with a link to Create. The message is the same for every token type, so it doesn't reveal which tokens exist.

### 8.7 Confirmations
Only **Call it off** is confirmed (inline). Publishing isn't confirmed; the card *is* the preview. Withdraw goes through a one-button page (§6.2). Commit isn't confirmed.

### 8.8 Date and time
- Every time is shown in the plan's city time zone (America/Los_Angeles), with no zone label, since the PoC is Bay Area only.
- Format: `Sat 9 Nov · 10:00 AM` on pages, and `Thu 7 Nov, 10:00 AM` in the deadline sentence. 12-hour clock with AM/PM (US audience).
- Relative hints are added where they help: "Decide by Thu 7 Nov, 10:00 AM (in 2 days)".

### 8.9 Copy and voice
- Second person, contractions, short sentences, no exclamation marks except "It's on!".
- UI words: **I'm in** (commit button), **minimum**, **Decide by** (the commit deadline), **It's on** (confirmed), **Not this time** (called off), **Withdraw**, **Call it off**, **Start a new plan from this**. Never: RSVP, event, cancel(led), failed, threshold, quorum, organizer, host.
- Never name or count who *didn't* commit.

**Emails** (plain, single column, text-first; each committer email except the creator's has a "Can't make it? Withdraw" footer link, FR016, except "Not this time", which has nothing to withdraw from. The approved bodies for confirmed and the reminders are in calvin-4's `epics.md`, Stories 3.2 and 3.3, and frames E1–E4):
| Email | Subject | Body gist |
|-------|---------|-----------|
| Manage link (creator) | Your plan: Coffee at Blue Bottle, Sat 9 Nov | Here's your private link to see who's in or call it off. Don't share it. Paste this one in your chat: [public link] |
| Confirmed | It's on: Coffee at Blue Bottle, Sat 9 Nov 10:00 AM | "It's on." Who's in (first names), where, when, a map link to the venue name + city, "We'll remind you the day before and that morning." |
| Reminder, 24h | Tomorrow: Coffee at Blue Bottle, 10:00 AM | Where, when, who's in |
| Reminder, morning | Today: Coffee at Blue Bottle, 10:00 AM | Same |
| Not this time | Not this time: Coffee on Sat 9 Nov | Called off at the deadline, to everyone who was in, the creator included: "This one didn't come together, and that's fine. Nobody's going, so there's nothing to do." No names, no counts, no withdraw link |
| Called off (by the creator) | Called off: Coffee on Sat 9 Nov | To everyone who was in except the creator: "Ana called off Coffee at Blue Bottle. Nothing to do." No counts, no other names, no withdraw link. The creator gets no email (operator, 2026-11-11) |
| Check-in (creator) | Did it happen? Coffee on Sat 9 Nov | Two questions with Yes / No links (§6.4) |

### 8.10 Link previews (chat apps)
The public page sets Open Graph tags, rendered server-side so chat apps can read them:
- `og:title`: "Coffee at Blue Bottle, College Ave"
- `og:description`: "Sat 9 Nov · 10:00 AM · Oakland. Goes ahead if 3 are in." On a confirmed plan: "…It's on."
- `og:image`: one static, generic calvin card (warm background + wordmark). No per-plan image in the PoC.
- `og:site_name`: "calvin". A called-off plan's preview says "Not this time".
- The manage, withdraw and check-in pages set `noindex` and generic OG tags, so they never show plan details in a preview.

---

## 9. Responsive & Accessibility

### 9.1 Breakpoints
One layout. A fluid single column, max 440px, centred; from 360px up nothing changes but the side whitespace. The public page fits the plan, the seats and the **I'm in** button within 360×640 for up to ~5 committers.

### 9.2 Accessibility
**Target**: WCAG 2.2 AA.
| Requirement | Specification |
|-------------|---------------|
| Contrast | Per §4.1: text ≥ 4.5:1, borders and dots ≥ 3:1, in both themes |
| Keyboard | Everything reachable by Tab in reading order; Enter submits forms; Escape closes an open edit row |
| Focus | 2px `--berry` outline, 2px offset, never removed |
| Touch targets | ≥ 48px for buttons and inputs, ≥ 44×44 for text buttons (Edit, Change) |
| Semantics | One `<h1>` per page (the venue on the plan page); `<label for>` on every input; seat row as a labelled list |
| Live regions | Suggestion loading/result and "Copied" use `aria-live="polite"`; post-commit notices use `role="status"` |
| Motion | Only the spinner moves; it's replaced by static text under `prefers-reduced-motion` |
| Language | `lang="en"`; dates written out ("Sat 9 Nov"), never only numeric |

**Testing (PoC)**: axe DevTools on each screen, one keyboard-only pass, one VoiceOver pass on iOS through the public page commit, and a real tap-through from WhatsApp's and iMessage's in-app browsers on one iPhone and one Android.

---

## 10. Implementation Guidance

### 10.1 Priority
1. Tokens + base stylesheet (§4), with dark mode.
2. Public plan page with seat row, state pill and commit form (Journey 2 is the core).
3. Create page with suggestion card and fallback; Published screen.
4. Manage page, withdraw page, check-in thanks, not-found.
5. Emails and OG tags.

### 10.2 Development Notes
- The public page must work with JS disabled (in-app browsers vary); JS is only progressive enhancement.
- No web fonts, images or third-party scripts on the public page. The OG image is the only image asset.
- Names are shown as the first word of what was entered, HTML-escaped; full names are visible only on the manage page.

### 10.3 Handoff Checklist
- [x] All screens and states specified (mockups 1a–5 + §6)
- [x] Responsive behaviour defined
- [x] Accessibility requirements set
- [x] Copy for UI and emails
- [ ] Final configured city list (architecture stage)

---

## Appendix

### A. Related Documents
- [brief.md](./brief.md), [PRD.md](./PRD.md), [GLOSSARY.md](../../GLOSSARY.md)

### B. Visual Deliverables
- [ux/epic-3.html](./ux/epic-3.html): the current look. A flow map of Epics 1–3, every built screen restyled with what changes, every Epic 3 screen and email, at 360px, light and dark, with the CSS of §4 and §7
- [ux/mockups.html](./ux/mockups.html): the first version's screens at 360px, in the old palette. Still the reference for Epic 4's screens, restyled to §4

### C. Version History
| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2026-10-26 | 1.0 | Initial spec: warm & casual direction, hand-written CSS, seat row, one-page progressive create | rodolfo@leapfrogger.ai |
| 2026-11-04 | 1.1 | New look (operator, #191): berry on lilac-grey replaces terracotta on off-white (§4.1), a serif for the venue (§4.2), seat tokens, per-state pills, link box and inline confirm (§7.2), the wordmark on every page (§5), no withdraw link in "Not this time" (§8.9). Visual reference: ux/epic-3.html | rodolfo@leapfrogger.ai |
| 2026-11-11 | 1.2 | Epic 5 mockups (operator, #290): every flow end to end. The creator's call-off gets its own email, "Called off", and the creator gets none (§8.9). Visual reference: ux/epic-5.html | rodolfo@leapfrogger.ai |
