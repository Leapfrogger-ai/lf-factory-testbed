# Readiness: calvin-3

Decision: ready
Security signoff: yes
Reopen stage: none
Maturity: poc

## Findings

No blocking findings.
- All 24 acceptance criteria across Stories 2.1–2.3 are checkable headlessly. They use Hono `app.request()` route tests, the fake `planWorkflows`, and the event log. Story 2.3's confirm page, withdraw POST, 404 and token-validation checks also run in tests. None needs a phone, browser, deploy, paid API call or the Temporal CLI. The real withdraw link in emails is explicitly left to Epic 3.
- `test-strategy.md` exists. Story order is backward-only (2.1, then 2.2, then 2.3). Stories use the publisher format, with no Tasks and no file paths.
- Brownfield claim holds. The repo has `src/domain`, `src/web` and `src/temporal`. `.github/workflows/ci.yml` runs `npx tsc --noEmit`, `npx vitest run` and gitleaks. These cover every mechanical rule in `CODING_STANDARDS.md`. Leaving out Story 1 and the guardrails story is justified.
- Security gate `secrets` is met. `architecture.md`'s Security Architecture has a Secrets table covering all four secrets (Anthropic, Resend, Temporal, `DATABASE_URL`), with where each lives and how it reaches the code, plus the rules.
- Platform Capabilities rows link research findings that exist under `specs/calvin-3/research/`. Each row has a rule in `CODING_STANDARDS.md`. No story hand-rolls a platform feature: the signal uses `planWorkflows.signal`, and upsert and locking are native Drizzle.
- Low: `CODING_STANDARDS.md` links its findings under `specs/calvin/research/`, not `specs/calvin-3/research/`. Both paths exist, so nothing breaks.
- Low: the PRD, architecture and other documents still describe Epics 1, 3 and 4. `epics.md` says so, so this is expected.

Written by the factory's readiness check (ADR 0017), from its structured output.
