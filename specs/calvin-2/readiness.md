# Readiness: calvin-2

Decision: ready_with_conditions
Security signoff: yes
Reopen stage: none
Maturity: poc

## Findings

Medium: CODING_STANDARDS.md "Platform" rules cite `specs/calvin/architecture.md` and `specs/calvin/research/*` (calvin's folder, still present), not calvin-2's. Links resolve, and the rules match calvin-2's Platform Capabilities rows. Repoint them when convenient.
Medium: Story 1.9 adds in-memory rate limiting, which the Platform Capabilities table doesn't cover. It is hand-rolled by design (API spec §4), but add a "not used" note so a reviewer doesn't flag it.
Medium: Story 1.7's real-call checks (a one-off hand capture of the good response, and p95 latency ≤15s over 10 calls) need a live Anthropic key and are marked "checked by hand". That fits the epics' rule on checks a story session can't run.
Low: Story 1.4 repeats rules already in the API spec's R3/§3.2. The criteria are testable at the Routes seam, so no change is needed.
Passed: all required documents are present, including test-strategy.md. No TBD or TODO remains.
Passed: PRD FR007 and the API spec's R3 deadline rule were updated for the halfway floor, matching the epics.
Passed: the carried-on brownfield claims hold. `src/` has config, db, domain, web and temporal. `tests/ci-workflow.test.ts` and the guardrails tests exist. `.github/workflows/ci.yml` runs the test, type-check and gitleaks steps. The `suggestions` and `email_sends` tables are already in `schema.ts`.
Passed: story prerequisites point backward only (1.7→1.4, 1.8→1.7, 1.9→1.7), with no cycles. Stories use the publisher's format, with Given/When/Then criteria, no Tasks and no file paths.
Passed: every Platform Capabilities row links a research finding that exists. Each row has a rule in CODING_STANDARDS.md. No story hand-rolls a row, and 1.4 and 1.5 use `hono/csrf`, Resend idempotency keys and tags.
Passed: security gate `secrets`. The Secrets table in "Security Architecture" lists all four secrets, where each lives and how it reaches the code, and the rules are clear. The gitleaks check is among the mechanical rules.

Written by the factory's readiness check (ADR 0017), from its structured output.
