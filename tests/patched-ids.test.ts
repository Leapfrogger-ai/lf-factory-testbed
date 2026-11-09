import { expect, test } from 'vitest';
import { patchedIdProblems, type Source } from './support/patched-ids.ts';

const workflow = (...ids: string[]): Source[] => [
  {
    file: 'src/temporal/workflows.ts',
    text: ids.map((id) => `if (patched('${id}')) {}`).join('\n'),
  },
];

const replay = (name: string, fixture = 'recorded'): Source => ({
  file: 'tests/workflow/x.test.ts',
  text: `it('${name}', async () => {\n  await Worker.runReplayHistory(opts, loadHistory('${fixture}'));\n});\n`,
});

const realIds = ['confirmed-emails-3-2', 'reminders-3-3', 'call-off-3-5'];

test('a patched id no replay test names is a problem', () => {
  const problems = patchedIdProblems(
    workflow('example-x', 'confirmed-emails-3-2'),
    [replay('replays before confirmed-emails-3-2')],
  );
  expect(problems).toEqual([expect.stringContaining('example-x')]);
});

test('several tests naming one id leave only the unnamed id as a problem', () => {
  const problems = patchedIdProblems(workflow(...realIds), [
    replay('replays before reminders-3-3'),
    replay('replays again, reminders-3-3'),
    replay('replays before confirmed-emails-3-2'),
  ]);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('call-off-3-5');
});

test('a fixture name passed to loadHistory names the id', () => {
  const problems = patchedIdProblems(workflow('call-off-3-5'), [
    replay('replays an old history', 'before-call-off-3-5'),
  ]);
  expect(problems).toEqual([]);
});

test('an id only in a comment inside a replay test is still a problem', () => {
  const commented: Source = {
    file: 'tests/workflow/x.test.ts',
    text: "it('replays', async () => {\n  // covers call-off-3-5\n  await Worker.runReplayHistory(opts, loadHistory('recorded'));\n});\n",
  };
  expect(patchedIdProblems(workflow('call-off-3-5'), [commented])).toEqual([
    expect.stringContaining('call-off-3-5'),
  ]);
});

test('a test naming the id but not replaying a history is still a problem', () => {
  const noReplay: Source = {
    file: 'tests/workflow/x.test.ts',
    text: "it('mentions call-off-3-5', async () => {\n  expect(1).toBe(1);\n});\n",
  };
  expect(patchedIdProblems(workflow('call-off-3-5'), [noReplay])).toEqual([
    expect.stringContaining('call-off-3-5'),
  ]);
});

test('an id that only extends the patched id does not name it', () => {
  expect(patchedIdProblems(workflow('reminders-3-3'), [replay('replays reminders-3-3b')])).toEqual([
    expect.stringContaining('reminders-3-3'),
  ]);
});

test('a replay test outside tests/workflow does not count', () => {
  const elsewhere = { ...replay('replays call-off-3-5'), file: 'tests/other.test.ts' };
  expect(patchedIdProblems(workflow('call-off-3-5'), [elsewhere])).toEqual([
    expect.stringContaining('call-off-3-5'),
  ]);
});

test('a commented-out loadHistory inside a replay test does not name the id', () => {
  const commented: Source = {
    file: 'tests/workflow/x.test.ts',
    text: "it('replays', async () => {\n  // loadHistory('call-off-3-5')\n  /* loadHistory('call-off-3-5') */\n  await Worker.runReplayHistory(opts, loadHistory('recorded'));\n});\n",
  };
  expect(patchedIdProblems(workflow('call-off-3-5'), [commented])).toEqual([
    expect.stringContaining('call-off-3-5'),
  ]);
});

test('a commented-out whole test does not name the id', () => {
  const commented: Source = {
    file: 'tests/workflow/x.test.ts',
    text: "it('replays', async () => {\n  await Worker.runReplayHistory(opts, loadHistory('recorded'));\n});\n// it('old', async () => {\n//   await Worker.runReplayHistory(opts, loadHistory('call-off-3-5'));\n// });\n",
  };
  expect(patchedIdProblems(workflow('call-off-3-5'), [commented])).toEqual([
    expect.stringContaining('call-off-3-5'),
  ]);
});

test('a skipped test does not name the id', () => {
  const skipped: Source = {
    file: 'tests/workflow/x.test.ts',
    text: "it('replays', async () => {\n  await Worker.runReplayHistory(opts, loadHistory('recorded'));\n});\nit.skip('old', async () => {\n  await Worker.runReplayHistory(opts, loadHistory('call-off-3-5'));\n});\n",
  };
  expect(patchedIdProblems(workflow('call-off-3-5'), [skipped])).toEqual([
    expect.stringContaining('call-off-3-5'),
  ]);
});

test('a name that merely ends with the id does not name it', () => {
  expect(patchedIdProblems(workflow('reminders-3-3'), [replay('replays xreminders-3-3')])).toEqual([
    expect.stringContaining('reminders-3-3'),
  ]);
});

test('the same id in two workflow sources is one problem', () => {
  const problems = patchedIdProblems(
    [...workflow('example-x'), ...workflow('example-x')],
    [],
  );
  expect(problems).toEqual([expect.stringContaining('example-x')]);
});
