# CR-1: Story 1.9: publish limit is 3 per IP per hour, not 5

- **Class:** story_change
- **Trigger:** Commit 0058ceb (#152, operator) changed specs/calvin-2/api-specification.md §4 so `POST /plans` allows 3 per IP per hour. Story 1.9's third acceptance criterion in specs/calvin-2/epics.md still says 5 requests and a 6th. The story says its limits are the API specification's §4, so the criterion now contradicts its source. Look-ahead after #129 merged found it on #131. (found by look-ahead after #129 merged)
- **Affects:** #131
- **Impact:** One story changes: 1.9 (#131), v1 to v2, with one acceptance criterion reworded and nothing else. No other story, PRD, architecture or API spec text mentions the old number. Redone work: none yet, as #131 hasn't been built. Its plan and tests must use 3 and a 4th request.

## Changes to epics.md

- Story 1.9: new version
