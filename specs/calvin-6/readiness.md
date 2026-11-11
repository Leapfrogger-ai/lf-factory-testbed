# Readiness: calvin-6

Decision: ready
Security signoff: yes
Reopen stage: none
Maturity: poc

## Findings

The earlier findings are resolved, and no new blocking findings turned up.
- Stories 5.1, 5.2, 5.3 and 5.6 now name their 360px and phone checks as operator checks after the merge, in each story's text and not as criteria. Every acceptance criterion in 5.1 to 5.6 is a Given/When/Then that a test can check headlessly (HTML, CSS text, emails, replay tests).
- Security: the `secrets` gate is met. `architecture.md` has the Secrets table (ANTHROPIC_API_KEY, RESEND_API_KEY, TEMPORAL_API_KEY, DATABASE_URL) with handling rules, and CI runs gitleaks. `security_signoff` is true.
- Platform Capabilities: every row links a finding under `specs/calvin-6/research/` that exists, and `CODING_STANDARDS.md` has a rule for each row. No story hand-rolls a platform feature. Story 5.5 keeps the workflow unchanged, with no new `patched()` id, and requires the replay tests to pass unchanged.
- Brownfield claim holds: `.github/workflows/ci.yml` exists and runs gitleaks, `npx tsc --noEmit` and `npx vitest run`. Omitting a starter story and a guardrails story is justified.
- Stories are in the publisher format, with backward-only prerequisites (5.1 has None, then 5.2 through 5.6 in order). The FR024 change is recorded as decided.
- Minor, not blocking: `CODING_STANDARDS.md` links `specs/calvin/...` for the research findings. Those files exist there, so the links resolve.

Written by the factory's readiness check (ADR 0017), from its structured output.
