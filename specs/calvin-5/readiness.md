# Readiness: calvin-5

Decision: ready
Security signoff: yes
Reopen stage: none
Maturity: poc

## Findings

No critical or high findings. All inputs are present, including the required test-strategy.md. I read epics.md, test-strategy.md, CODING_STANDARDS.md, the API spec's R12, the schema's tables and "Trial metric queries" section, and architecture.md's Platform Capabilities and Security Architecture. The research files exist, but I didn't open them to check that they cite the platform's own documentation. I couldn't run grep or ls (Bash was denied), so I did not grep the repo for placeholder text or check the file listing beyond the first `ls`.

Minor, not blocking:
- CODING_STANDARDS.md links its findings and test-strategy under `specs/calvin/...`, while this initiative's documents are under `specs/calvin-5/`. If `specs/calvin/` is gone from main, those links break. The rules themselves are fine.
- The only existing guardrail (tests/guardrails-source.test.ts) compares replay-call counts with patch-id counts. Story 4.1 replaces that, so the gap is covered.
- Story 4.7's outcomes-query criterion assumes row order by `created_at`. The query has that ORDER BY, so it holds.

Checks that passed:
- Epics 1 to 3 are marked merged, with a brownfield claim (calvin to calvin-4 merged them).
- Prerequisites run strictly backward: 4.1, then 4.2, 4.3, 4.4, 4.5, 4.6, 4.7.
- Stories use the publisher format. There are no `Tasks:` lines and no file paths.
- Every acceptance criterion is checkable by a Vitest test at a seam the test strategy names: Plan workflow with the time-skipping server, Routes with `app.request()`, Plan operations, Send ledger, and the schema's metric queries against the embedded Postgres. None needs a phone, browser, deploy, real API key or the Temporal CLI. NFR010 is left out and named as operator work after the epic.
- FR027 to FR029 are covered by Stories 4.5, 4.6 and 4.7. R12's copy, the `check_in_answers` table and the `check_in` and `check_in.answered` kinds all exist in the API and schema documents.
- No story hand-rolls a platform capability. 4.4 uses the signal plus a database re-read, which follows ADR 0002.
- The Platform Capabilities rows each have a rule in CODING_STANDARDS.md and a link to a finding under `research/`.
- The secrets gate (PoC) is met: Security Architecture has a Secrets table covering the four secrets, plus rules on logging and redaction. The gitleaks mechanical rule is in CODING_STANDARDS.md and CI.

Written by the factory's readiness check (ADR 0017), from its structured output.
