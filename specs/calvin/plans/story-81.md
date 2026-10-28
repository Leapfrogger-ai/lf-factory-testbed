# Guardrails in CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `ci` job checks the mechanical rules (secret scan, types, tests) and a test suite proves each check fails on the input it exists to catch.

**Architecture:** `.github/workflows/ci.yml` already runs checkout, `npm ci`, `npx tsc --noEmit`, `npx vitest run`, and `tsconfig.json` already has the five flags (story 1.1). This story adds the gitleaks CLI step and a job timeout, and adds tests that run the real tools (`tsc`, `vitest`, `gitleaks`) on throwaway fixtures written to a temp directory, so a failing fixture never enters the project's own `tsc`/`vitest` runs.

**Tech Stack:** GitHub Actions, gitleaks CLI, TypeScript 7 (`tsc`), Vitest 5, Node 26 (`node:child_process`, `node:fs`, `node:os`).

**Spec:** .factory/story.md (story #81)

## Global Constraints

- Types | TypeScript, `tsconfig.json` with `"strict": true`, `"erasableSyntaxOnly": true`, `"verbatimModuleSyntax": true`, `"allowImportingTsExtensions": true`, `"noEmit": true` | `npx tsc --noEmit`
- Tests pass | Vitest 5, `vitest.config.ts` as test-strategy.md's Commands section says | `npx vitest run`
- No secret committed | gitleaks CLI (the binary, not gitleaks-action, which needs a license key for organizations), default rules, `--redact` | `gitleaks git --redact --exit-code 1` over the PR's commits
- Formatting | None at poc | —
- Lint | None at poc (test-strategy.md) | —
- The CI job: `ci` in `.github/workflows/ci.yml`, on every pull request to `main`; `ubuntu-latest`, Node 26, no Postgres service (the tests start their own with `embedded-postgres`, test-strategy.md), `FACTORY_DB_NAME=calvin_test`; steps: checkout with full history (`fetch-depth: 0`) for gitleaks, `gitleaks git --redact --exit-code 1`, `npm ci`, `npx tsc --noEmit`, `npx vitest run`. No secrets are set in CI.
- No secret is read, stored, logged or committed other than as the architecture's Secrets table says (env vars from Fly secrets or a gitignored `.env`; never in `fly.toml`, the Dockerfile, the repo, a log line or a CI command line; `.env.example` holds names only) — a leaked secret can't be taken back.
- Mock only at system boundaries (the `deps` functions and the clock); never `vi.mock` a project file or spy on a project module — mocks of our own code test the mock.
- One test, then its implementation — tests written in bulk check imagined behaviour.
- Secrets are set with `fly secrets set` (interactive or from stdin), never written in `fly.toml`, the Dockerfile, the repo, a log line or a CI command line. `.env` is in `.gitignore`. `.env.example` lists names only.
- Use Node 26's native TypeScript type stripping to run `.ts`; don't add a `tsc`/esbuild build pipeline — [finding](specs/calvin/research/node-hono-drizzle.md)
- It must finish within 5 minutes.

Binding: CODING_STANDARDS.md, specs/calvin/test-strategy.md, specs/calvin/architecture.md

## Review Focus

- A test secret written literally in a test file would itself trip gitleaks on this very PR: build it at runtime (Task 4).
- gitleaks absent on a developer's machine: the secret test skips locally instead of failing; in CI the binary is installed first, so it runs (Task 4).
- A failing fixture must never sit inside `src`/`tests`, or the project's own `tsc` and `vitest` runs go red (Tasks 2, 3).
- The log of a failed scan must not contain the secret value (Task 4 asserts the output lacks it).
- The workflow must not gain `secrets.` or `services:` (the existing test keeps this; Task 1 keeps it green).

---

## Existing state (do not redo)

`.github/workflows/ci.yml` has checkout (`fetch-depth: 0`), setup-node 26, `npm ci`, `npx tsc --noEmit`, `npx vitest run`, env `FACTORY_DB_NAME: calvin_test`. `tests/ci-workflow.test.ts` asserts that structure. `tsconfig.json` has all five flags and `tests/project.test.ts` asserts them.

## Task 1: gitleaks step and job timeout in the workflow

**Covers:** AC4, AC5

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `tests/ci-workflow.test.ts`

**Interfaces:**
- Produces: a workflow whose step order is checkout, install gitleaks, `gitleaks git --redact --exit-code 1`, setup-node, `npm ci`, `npx tsc --noEmit`, `npx vitest run`; the job has `timeout-minutes: 5`.

- [ ] **Step 1: Write the failing tests** in `tests/ci-workflow.test.ts`: change the order test so `steps` is `['gitleaks git --redact --exit-code 1', 'npm ci', 'npx tsc --noEmit', 'npx vitest run']` (same ascending-position assertion); add `it('fails the job after 5 minutes')` expecting `workflow` toContain `timeout-minutes: 5`; add `it('uses the gitleaks CLI, not gitleaks-action')` expecting `workflow` not toContain `gitleaks-action`.
- [ ] **Step 2: Run** `npx vitest run tests/ci-workflow.test.ts`. Expected: the changed and new tests FAIL.
- [ ] **Step 3: Edit `ci.yml`.** Add `timeout-minutes: 5` under `ci:`. After checkout add a step "Install gitleaks" that downloads a pinned release tarball (`gitleaks_<version>_linux_x64.tar.gz` from the gitleaks GitHub releases, `curl -sSfL`) and extracts `gitleaks` into `/usr/local/bin` (needs `sudo`); pick a version that exists. Then a step `run: gitleaks git --redact --exit-code 1`. Keep the other steps and their order. No token, no secret.
- [ ] **Step 4: Run** `npx vitest run tests/ci-workflow.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git add .github/workflows/ci.yml tests/ci-workflow.test.ts`, message `ci: scan commits with the gitleaks CLI, cap the job at 5 minutes`.

## Task 2: Type errors and enums fail `tsc`

**Covers:** AC1, AC2

**Files:**
- Create: `tests/support/run-in-temp-project.ts`
- Create: `tests/guardrails-types.test.ts`

**Interfaces:**
- Produces: `runInTempProject(files: Record<string, string>, command: string[]): { status: number | null; output: string }` — writes `files` into a fresh `mkdtempSync(join(tmpdir(), 'guardrail-'))` directory, runs `command` there with `spawnSync` (cwd is that directory, `encoding: 'utf8'`), returns exit status and stdout+stderr combined, and removes the directory afterwards. Tasks 3 and 4 reuse it.

- [ ] **Step 1: Write the failing test** `tests/guardrails-types.test.ts`. A local `tsc(files)` calls `runInTempProject` with a `tsconfig.json` whose `extends` is the absolute path of the repo's `tsconfig.json` and `include` is `["*.ts"]`, plus `files`, and the command `[process.execPath, <tsc entry resolved from the typescript package>, '--noEmit']`. Tests:
  - `clean file passes`: `export const a: number = 1;` → status 0.
  - `type error fails`: `export const a: number = 'x';` → status not 0, output contains `TS2322`.
  - `enum fails under erasableSyntaxOnly`: `export enum Color { Red }` → status not 0, output contains `TS1294`.
- [ ] **Step 2: Run** `npx vitest run tests/guardrails-types.test.ts`. Expected: FAIL (helper missing).
- [ ] **Step 3: Implement** `runInTempProject` as specified. `"types": ["node"]` resolves relative to the extended config, so it works from a temp directory.
- [ ] **Step 4: Run** the test again. Expected: PASS. Then `npx tsc --noEmit` must stay clean.
- [ ] **Step 5: Commit** `git add tests/support/run-in-temp-project.ts tests/guardrails-types.test.ts`, message `test: tsc rejects type errors and enums`.

## Task 3: A failing test fails `vitest run`

**Covers:** AC3

**Files:**
- Create: `tests/guardrails-tests.test.ts`

**Interfaces:**
- Consumes: `runInTempProject` from Task 2.

- [ ] **Step 1: Write the test** `tests/guardrails-tests.test.ts`: run `[process.execPath, <vitest.mjs from the vitest package>, 'run']` in a temp project holding only `sample.test.ts` (imports `expect, it` from `vitest`) and no config. Cases: `passing test exits 0` (`expect(1).toBe(1)`) and `failing test exits non-zero` (`expect(1).toBe(2)`, output contains `FAIL`).
- [ ] **Step 2: Run** `npx vitest run tests/guardrails-tests.test.ts`. This characterises an existing check, so it may pass at once; to see RED, flip the failing case's expected status to 0 temporarily, confirm FAIL, then restore.
- [ ] **Step 3: Run** `npx vitest run`. Expected: all green (the temp project's failing test is not collected by the outer run).
- [ ] **Step 4: Commit** `git add tests/guardrails-tests.test.ts`, message `test: vitest run fails on a failing test`.

## Task 4: A committed secret fails gitleaks, redacted

**Covers:** AC4

**Files:**
- Create: `tests/guardrails-secrets.test.ts`

**Interfaces:**
- Consumes: `runInTempProject` from Task 2, with command `['sh', '-c', 'git init -q && git add . && git -c user.email=t@t -c user.name=t commit -qm x && gitleaks git --redact --exit-code 1']`.

- [ ] **Step 1: Write the failing test.** `const hasGitleaks = spawnSync('gitleaks', ['version']).status === 0`; wrap in `describe.skipIf(!hasGitleaks)`. Build the secret at runtime from parts (a GitHub-token shape joined in code), never as one literal; check once locally that gitleaks flags the chosen string and adjust until it does. Tests: `clean commit passes` (`a.txt` containing `hello` → status 0) and `commit with a secret fails and is redacted` (`config.ts` containing `export const token = '<secret>';` → status 1, output contains `REDACTED`, output does not contain the secret).
- [ ] **Step 2: Run** `npx vitest run tests/guardrails-secrets.test.ts`. Expected: SKIPPED if gitleaks is absent locally (say so in the commit message), else PASS. If gitleaks is available, first run with a clean file in the secret case and confirm FAIL.
- [ ] **Step 3: Confirm** the repo is clean: if gitleaks is installed, `gitleaks git --redact --exit-code 1`. Expected: exit 0.
- [ ] **Step 4: Commit** `git add tests/guardrails-secrets.test.ts`, message `test: gitleaks fails a commit holding a secret, redacted`.

## Rulings

Ruling: Install gitleaks by pinned release tarball in the workflow — the story names the CLI but not how it reaches the runner, and `ubuntu-latest` doesn't ship it — if the pinned download fails, CI is red until the pin is fixed.
Ruling: Run the story's exact `gitleaks git --redact --exit-code 1` with no `--log-opts` — the story pins the command — a PR whose base already holds an old secret would fail too.
Ruling: Add `timeout-minutes: 5` to the job — AC5 wants every step within 5 minutes and this makes an overrun a visible failure — a slow cold `npm ci` plus tests turns the build red.
Ruling: The mechanical-rule tests run the real tools on temp-directory fixtures rather than asserting merge blocking — branch protection is the operator's GitHub setting and untestable here — the "merge is blocked" half of AC1–AC4 rests on `ci` being a required check.
Ruling: AC5 is covered by Task 1's timeout plus a clean full run of `npx tsc --noEmit` and `npx vitest run` — wall-clock on GitHub's runner can only be confirmed on the PR itself.
