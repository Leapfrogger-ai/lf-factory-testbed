# Readiness: idea17-check

Decision: ready
Security signoff: yes
Reopen stage: none
Maturity: poc

## Findings

Every document the last check found missing is now present: test-strategy.md (required), architecture.md, brief.md (Maturity poc), ux-spec.md, database-schema.md, api-specification.md and the research findings.
Security gate `secrets` is met. architecture.md's Security Architecture has a Secrets table with where each secret lives and how it reaches the code. The initiative adds no secret, dependency or external call, and CI runs gitleaks.
The brownfield claims in epics.md hold. `.github/workflows/ci.yml` runs gitleaks, `npx tsc --noEmit` and `npx vitest run` on every PR to main. Every mechanical rule in CODING_STANDARDS.md names a check that file runs. package.json has a `test` script, and README.md matches the three-line description in epics.md. So no starter or guardrails story is needed.
Platform Capabilities rows each link a finding that exists, and CODING_STANDARDS.md has a rule per row. No story builds what a row says the platform provides, because the stories only edit the readme.
Both stories use the publisher's format: `### Story n.m (v1)`, story-level `Prerequisites: None`, Given/When/Then criteria, no Tasks, no file paths. They are independent, with no cycles. Story 1.2 is written to keep Story 1.1's sentence if it has already merged.
Every acceptance criterion can be checked headlessly, by reading or diffing the readme. None needs a phone, browser, API key, deploy or Temporal CLI.
PRD FR001 and FR002 each map to one story, and there are no orphan stories.
Minor, not blocking: CODING_STANDARDS.md and the research links point at `specs/calvin/...` while the design documents were copied from `specs/calvin-4`. The linked paths exist, so nothing breaks.

Written by the factory's readiness check (ADR 0017), from its structured output.
