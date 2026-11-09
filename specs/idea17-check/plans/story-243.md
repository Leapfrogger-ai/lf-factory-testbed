# Readme says the testbed is never reset during a run — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the readme's description line so `Reset before each run.` becomes `Reset before each run, never during one.`

**Architecture:** One in-place substitution on one line of `README.md`; nothing else changes. Checked by shell commands that read and diff the readme, because the initiative adds no vitest test for a readme edit.

**Tech Stack:** Markdown, git, shell (`grep`, `git diff`).

**Spec:** .factory/story.md (story #243)

## Global Constraints

- Maturity: **poc**. Terms are the ones in `GLOSSARY.md`.
- Docs only. The only file that changes is the readme at the root of the repository.
- The test command (`npx vitest run`) and the type check (`npx tsc --noEmit`) must still pass. Neither is affected by a readme change.
- A test that passes on its first run is shown to fail, by a recorded RED run or a mutation of the code it pins — a test that can't fail guards nothing.
- No secret is read, stored, logged or committed other than as the architecture's Secrets table says
- Each criterion is checked by reading the readme, so no story adds a test.
- `TEST_DATABASE_URL` is `postgres://postgres:calvin@127.0.0.1:${FACTORY_PORT_BASE + 2}/${FACTORY_DB_NAME:-calvin_test}`, with the port base defaulting to 20000. It's built in `vitest.config.ts`, never read from `.env`, so a test can't reach a Neon database.

Binding: CODING_STANDARDS.md, specs/idea17-check/PRD.md, specs/idea17-check/epics.md, specs/idea17-check/test-strategy.md

## Review Focus

- Main's line has gained another story's sentence (` Home of calvin, the small-gatherings app.`) before this merges: it must survive, in order, after the new clause.
- The replaced text must not leave a bare `Reset before each run.` (the new text contains `Reset before each run,` which is fine).
- Trailing newline, title and blank line must be byte-identical (the diff touches one line only).

All three are pinned by the checks in Task 1.

## File Structure

- Modify: `README.md` (line 3, the description line). Nothing else.

### Task 1: Say the testbed is never reset during a run

**Covers:** AC1, AC2, AC3

**Files:**
- Modify: `README.md:3`

**Interfaces:**
- Consumes: the description line as it is on `main` at build time (today `The factory's testbed. Reset before each run.`; it may already end with ` Home of calvin, the small-gatherings app.` if story 1.1 merged). Merge `main` first if it moved.
- Produces: nothing later tasks use.

- [ ] **Step 1: Run the failing checks (RED)**

Each check states one criterion. Use `origin/main` for the base if local `main` is stale.

```bash
# AC1
grep -qF "Reset before each run, never during one." README.md
! grep -F "Reset before each run." README.md
# AC2: main's line with only that clause replaced equals the readme's line
[ "$(git show main:README.md | sed -n 3p | sed 's/Reset before each run\./Reset before each run, never during one./')" = "$(sed -n 3p README.md)" ]
# AC3: exactly one hunk, on line 3
[ "$(git diff -U0 main -- README.md | grep -c '^@@')" = 1 ] && git diff -U0 main -- README.md | grep -q '^@@ -3 +3 @@'
```

Expected before the edit: the first grep exits 1 (FAIL), and the AC2 and AC3 checks fail too. Record the output.

- [ ] **Step 2: Edit `README.md` line 3**

Replace the substring `Reset before each run.` with `Reset before each run, never during one.` using a targeted replace. Leave every other character on the line, and every other line, untouched.

- [ ] **Step 3: Run the checks to verify GREEN**

Re-run the Step 1 commands. Expected: all exit 0 (the `! grep` line prints nothing, because `Reset before each run.` with its period no longer appears). Also run `git diff --stat main -- README.md` (expect `1 file changed, 1 insertion(+), 1 deletion(-)`), then `npx tsc --noEmit` and `npx vitest run` (expect both to pass).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Readme: the testbed is never reset during a run"
```

## Rulings

Ruling: Verify with shell checks, not a vitest test — epics.md says no story adds a test for a readme edit, and a test pinning the readme's text would break the sibling story's edit to the same line — if a reviewer wants a vitest test they must add one; the RED/GREEN shell runs stand in for it.
Ruling: Compare AC2 and AC3 against `main` at build time, not a hard-coded line — main's line may or may not include story 1.1's sentence — if local `main` is stale the check compares the wrong base, so use `origin/main` after fetching.
