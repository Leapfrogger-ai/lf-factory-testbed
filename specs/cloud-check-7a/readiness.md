# Readiness: cloud-check-7a

Decision: not_ready
Security signoff: yes
Reopen stage: standards
Maturity: poc

## Findings

1. CRITICAL: specs/cloud-check-7a/epics.md does not exist, so there are no stories to check or publish. That blocks implementation (reopen epics after the standards fix).
2. HIGH: CODING_STANDARDS.md links its Platform findings and test-strategy to specs/shape-check-7/..., but the spec lives under specs/cloud-check-7a/. The links are dead, so the Platform rules aren't tied to an existing finding. Fix the paths (stage standards, the earliest to reopen).
3. MEDIUM: the documents name the initiative 'shape-check-7' while the folder is cloud-check-7a. This is harmless, but it is the cause of finding 2.
4. NOT CHECKED: PRD.md, ux-spec.md, database-schema.md, api-specification.md and the brownfield claims (ci.yml, pyproject.toml). Bash was denied and I only read the files above. The brief, architecture, test-strategy, research and standards are consistent with each other, with no TBD placeholders.
5. OK: the Platform Capabilities rows (dict.pop, insertion order) link a research finding that cites docs.python.org, and each row has a rule in the standards. The test strategy has seams, real vs mocked, exact commands, and worktree isolation. The architecture's Secrets table (None) meets the poc 'secrets' gate, so security_signoff is true.

Written by the factory's readiness check (ADR 0017), from its structured output.
