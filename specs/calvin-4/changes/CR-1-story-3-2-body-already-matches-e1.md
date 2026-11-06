# CR-1: No spec change: Story 3.2's body block already matches frame E1

- **Class:** story_change
- **Trigger:** spec_review (story #196) said Story 3.2's "exactly" body block has no blank lines, while the approved E1 frame and the code have them. On this branch, `specs/calvin-4/epics.md:48-58` has blank lines after the "are in" line, after the Map line and after the reminder line. That matches frame E1 in `specs/calvin-4/ux/epic-3.html:725-731` byte for byte (checked with `cat -A`). `epics.md` has had a single commit, 057f31b, so the blank lines were not lost in a later edit. The finding looks stale or was read from a flattened copy of the story. `src/email/templates.ts` on this branch has no confirmed-email template yet, so the code could not be compared here. The finding says it should be written to match the story and frame E1. (found by spec_review)
- **Affects:** #196
- **Impact:** None. No story changes, so there are no version bumps and no work to redo. Story 3.2 (#196) stays at v1. If the reviewer is still seeing a body block without blank lines, they should re-check the rendering of the story text on the issue (#196) against `epics.md`. The issue body may have been flattened when it was published.

## Changes to epics.md

