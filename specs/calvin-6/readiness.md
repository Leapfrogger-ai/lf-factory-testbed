# Readiness: calvin-6

Decision: not_ready
Security signoff: yes
Reopen stage: epics
Maturity: poc

## Findings

1. Story 5.1's last criterion ("at 360px ... nothing scrolls sideways (checked by hand against frames P8, W3, W4, W5 and X2)") needs a browser, and a headless story session can't check it. The story doesn't say the operator checks it after the merge. Reword it as an operator check after the merge, or drop it.
2. Story 5.2's last criterion (inputs form and empty card at 360px match frames C1 and C7, "checked by hand") has the same problem. It needs a browser, with no "operator, after the merge" wording.
3. Story 5.6's last criterion (Yes/No buttons side by side, at least 48px tall, no sideways scroll at 360px, "checked by hand against frames K1–K3") has the same problem. Name it as an operator check after the merge, or turn the 48px and layout parts into CSS-assertion tests.
4. Story 5.3's phone Copy-button criterion is fine, because it says "checked by hand after the merge, on a phone". The 5.1, 5.2 and 5.6 criteria should use the same wording.
5. Minor, not blocking: CODING_STANDARDS.md still links `specs/calvin/...` for the research findings. Those files exist under `specs/calvin/`, so the links resolve.
Everything else checks out.
- All documents are present: brief (poc), PRD, epics, ux-spec, architecture, database-schema, api-specification, and test-strategy (required). Research findings exist for all five technologies.
- Platform Capabilities rows link research findings, and CODING_STANDARDS.md has a rule for each row.
- Security: the poc `secrets` gate is met. Architecture has the Secrets table for ANTHROPIC_API_KEY, RESEND_API_KEY, TEMPORAL_API_KEY and DATABASE_URL, with handling rules, so `security_signoff` is true.
- The brownfield claim holds. `.github/workflows/ci.yml` runs gitleaks, `npx tsc --noEmit` and `npx vitest run`, and the guardrail tests exist under `tests/`.
- Stories 5.1 to 5.6 are in the publisher format, with backward-only prerequisites and Given/When/Then criteria.
- The FR024 change (creator call-off email) is recorded in PRD §FR024 and ux-spec §8.9, and the story keeps the workflow unchanged (no new `patched()` id, replay tests unchanged).
- No TBD or TODO placeholders were found.

Written by the factory's readiness check (ADR 0017), from its structured output.
