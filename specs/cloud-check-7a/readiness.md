# Readiness: cloud-check-7a

Decision: ready_with_conditions
Security signoff: yes
Reopen stage: epics
Maturity: poc

## Findings

1. Count mismatch: epics.md has two stories (1.1 and the 1.2 guardrails story), but Epic 1's goal says "delivered as one story". PRD "Est. Stories" is 1, and architecture.md says "1 epic, 1 story". Make the counts agree. The guardrails story itself is justified, because the secret-scan rule has no CI check.
2. Story 1.2 traces to no FR or NFR in the PRD. Either note it in epics.md as the guardrails story for the CODING_STANDARDS.md secret-scan rule, or add a line for it to the PRD.
3. Story 1.2's second criterion needs a real credential-format commit pushed to prove the block. That is hard to verify and risky to run. Reword it to check the repo setting only (the first criterion already does this).
4. Story 1.1's last criterion names `pyproject.toml`. The publisher format says no file paths, so reword it to "no new dependency".
5. Passes: test-strategy.md is complete (seam, commands, worktree isolation, CI). Brownfield claims hold: ci.yml runs `uv sync --locked` and `uv run pytest`, and pyproject.toml has the pytest dev group and testpaths. Both Platform Capabilities rows have a research finding citing docs.python.org and a rule in CODING_STANDARDS.md. FR001–FR008 are all covered by Story 1.1. DB, API and UX documents are legitimately Not applicable.
6. Security gate `secrets` is met: the architecture has a Secrets table (none used). No other security depth is required at poc.

Written by the factory's readiness check (ADR 0017), from its structured output.
