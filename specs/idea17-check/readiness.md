# Readiness: idea17-check

Decision: not_ready
Security signoff: no
Reopen stage: test-strategy
Maturity: poc

## Findings

test-strategy.md is missing, and it is required, so the decision is not_ready. Epics.md cites the test command and setup command but nothing documents them, and there are no seams, FACTORY_* isolation or CI rules.
architecture.md is missing. Security Architecture has no Secrets table, which the PoC `secrets` gate requires, and the Platform Capabilities check can't run. Signoff is false. Reopen architecture too. Even a docs-only initiative needs the table, which can say there are no secrets.
brief.md is missing, so the Maturity line can't be verified. epics.md states poc itself.
ux-spec.md, database-schema.md and api-specification.md are absent. Each needs a `Not applicable: <reason>` file to be accepted. Docs-only work would justify that reason.
CODING_STANDARDS.md "Mechanical rules" and the brownfield claims in epics.md weren't checked, because test-strategy.md and architecture.md are missing. The epics don't say which CI file runs the tests. They also don't say the repo already has a runner, CI and app shell, so no Story 1 starter is justified.
The stories are in good shape. Both are independent and have Given/When/Then criteria that can be checked headlessly by reading the readme. They have no file paths or Tasks. Prerequisites are None. Story 1.2 has a soft tie to 1.1's sentence but handles it correctly.
PRD.md is present. I did not trace FR001 and FR002 to the stories in detail. The epics reference both.

Written by the factory's readiness check (ADR 0017), from its structured output.
