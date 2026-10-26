# calvin

calvin turns "we should get together" into gatherings that actually happen. It does this with a suggested plan and a commit threshold, so nobody owns the effort or the risk of an empty room.

## Language

**"We should" moment**:
An occasion when someone says "we should get together" to acquaintances without proposing anything specific. It starts the 30-day success clock.
_Avoid_: Intent, invitation

**Group**:
Acquaintances who already share a chat, such as neighbors, alumni or a WhatsApp subgroup. calvin doesn't model or store the group. It only reaches the group through the chat.
_Avoid_: Community, circle

**Creator**:
The person who creates a plan and shares its link. They don't host and don't carry the risk of the plan failing.
_Avoid_: Organizer, host, owner

**Plan**:
A concrete, low-stakes proposal suggested by calvin: format, venue, date and time, a minimum, and a commit deadline. It's reached by a link.
_Avoid_: Event, invite, proposal

**Manage link**:
The creator's private link to their plan. Through it they can call the plan off or start a new plan from it. It can't change a published plan.
_Avoid_: Admin link, edit link

**Commit**:
A person's yes to a plan, given with a name and an email address. A person who commits is a **committer**. The creator is always the plan's first committer.
_Avoid_: RSVP, sign-up, attend

**Withdraw**:
A committer taking back their commit. It lowers the count but never undoes a confirmed plan.
_Avoid_: Cancel, un-RSVP

**Minimum**:
The number of commits a plan needs by its commit deadline to go ahead. It counts the creator.
_Avoid_: Quorum, threshold (in UI copy)

**Commit deadline**:
The moment by which a plan must reach its minimum, or be called off.
_Avoid_: Cutoff, RSVP date

**Confirmed**:
The state of a plan that reached its minimum before the commit deadline. Its gathering is on. Once a plan is confirmed, it stays confirmed unless the creator calls it off.

**Called off**:
The state of a plan that won't happen, either because its commit deadline passed below its minimum or because the creator called it off. Committers are told quietly, and nobody is blamed.
_Avoid_: Cancelled, failed

**Gathering**:
The real-world meetup that happens when a plan is confirmed.
_Avoid_: Event, meetup

**Shared**:
A plan counts as shared once someone other than the creator has committed to it. calvin never sees the chat, so this is how the share rate is measured.

**Check-in**:
The "Did it happen?" and "Were you there?" email sent to the creator of a confirmed plan at 10:00 the day after its gathering. Its answers are recorded, but the follow-up interview stays the source of truth.
_Avoid_: Survey, feedback
