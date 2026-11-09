# Epics: idea17-check

Maturity: **poc**. A docs-only initiative: both stories change one line of the repository's readme, and nothing else. Each criterion is checked by reading the readme, so no story adds a test. The existing test command `npx vitest run` and type check `npx tsc --noEmit` must still pass, and the setup command is the one in the factory config.

The readme today has three lines: the title `# lf-factory-testbed`, a blank line, and the description line `The factory's testbed. Reset before each run.` Both stories change that description line. They're independent and may run at the same time.

## Epic 1: Readme wording

The readme's description line says what the testbed holds and when it's reset. It covers FR001 and FR002.

### Story 1.1 (v1): Say the testbed is home to calvin

As someone opening the repository, I want the readme to say what app lives here, so that I know what I'm looking at.

Add the sentence ` Home of calvin, the small-gatherings app.` to the end of the readme's description line, with one space before it. Change nothing else.

Prerequisites: None

Acceptance criteria:
- Given the readme, when its description line is read, then it ends with "Home of calvin, the small-gatherings app."
- Given the readme, when it's compared with main before this story, then the description line is the only line that changed, and the title is unchanged.

### Story 1.2 (v1): Say the testbed is never reset mid-run

As someone running the factory, I want the readme to say the testbed isn't reset during a run, so that nobody resets it while a run is going.

In the readme's description line, replace `Reset before each run.` with `Reset before each run, never during one.` Keep the rest of the line as it is on main, including any sentence other stories have added. Change nothing else.

Prerequisites: None

Acceptance criteria:
- Given the readme, when its description line is read, then it contains "Reset before each run, never during one." and no longer contains "Reset before each run." on its own.
- Given the readme, when its description line is compared with main's, then every other sentence on main's line is still there, in the same order.
- Given the readme, when it's compared with main, then the description line is the only line that changed.
