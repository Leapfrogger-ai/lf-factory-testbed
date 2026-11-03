# CR-2: Story 1.8: move the phone check out of the acceptance criteria and into an operator check after the merge

- **Class:** story_change
- **Trigger:** spec_review found that Story 1.8's last criterion is a phone hand check (Decide by updates, Copy reads "Copied" for 2s, the share sheet opens). A headless build session has no phone, so it cannot run the check. Commit 1e3ac52 marks all six plan Task 5 checks "NOT RUN in a browser (headless build session)". The epics.md header already says a check that needs a phone isn't a criterion: the story's text names it as a check the operator makes by hand after the merge. Story 1.8 does not follow that rule. (found by spec_review)
- **Affects:** #130
- **Impact:** Only Story 1.8 (#130) changes, v1 to v2. One criterion is removed and a paragraph is added to the story text. No code changes, because the behaviour is unchanged. The story's plan has to record the operator's phone check as pending instead of as a failed criterion. No other story, PRD or architecture file is touched.

## Changes to epics.md

- Story 1.8: new version
