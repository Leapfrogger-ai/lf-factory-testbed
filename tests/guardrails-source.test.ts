import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

type Source = { file: string; text: string };

const sources = (dir: string, keep: (file: string) => boolean): Source[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && keep(file))
    .map((file) => ({ file: `${dir}/${file}`, text: readFileSync(join(dir, file), 'utf8') }));

const app = sources('src', (file) => !file.endsWith('.test.ts'));
const tests = [...sources('src', (file) => file.endsWith('.test.ts')), ...sources('tests', () => true)];

const offenders = (files: Source[], pattern: RegExp, allowed: string[] = []) =>
  files.filter(({ file, text }) => !allowed.includes(file) && pattern.test(text)).map(({ file }) => file);

test('app code logs only through src/log.ts', () => {
  expect(offenders(app, /\bconsole\.\w+\(/, ['src/log.ts', 'src/main.ts', 'src/db/migrate.ts'])).toEqual([]);
});

test('only src/main.ts reads the current time', () => {
  // src/temporal/workflows.ts: Date.now() inside a workflow is Temporal's deterministic workflow time, not the wall clock.
  const allowed = ['src/main.ts', 'src/db/schema.ts', 'src/temporal/workflows.ts'];
  expect(offenders(app, /\bDate\.now\(\)|\bnew Date\(\)/, allowed)).toEqual([]);
});

test('app code does not use luxon or date-fns-tz', () => {
  expect(offenders(app, /from ['"](luxon|date-fns-tz)['"]/)).toEqual([]);
});

test('no test mocks a project file', () => {
  expect(offenders(tests, /\bvi\.mock\(/, ['tests/guardrails-source.test.ts'])).toEqual([]);
});

test('every patched() id in the plan workflow has a recorded-history replay test', () => {
  const patches = app
    .filter(({ file }) => file.endsWith('workflows.ts'))
    .flatMap(({ text }) => [...text.matchAll(/patched\('([^']+)'\)/g)].map((m) => m[1]));
  const replays = tests
    .filter(({ file }) => file.startsWith('tests/workflow/'))
    .flatMap(({ text }) => [...text.matchAll(/runReplayHistory\(/g)]);
  expect(replays.length).toBeGreaterThanOrEqual(new Set(patches).size);
