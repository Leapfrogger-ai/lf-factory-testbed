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
  expect(offenders(app, /\bDate\.now\(\)|\bnew Date\(\)/, ['src/main.ts', 'src/db/schema.ts'])).toEqual([]);
});

test('app code does not use luxon or date-fns-tz', () => {
  expect(offenders(app, /from ['"](luxon|date-fns-tz)['"]/)).toEqual([]);
});

test('no test mocks a project file', () => {
  expect(offenders(tests, /\bvi\.mock\(/, ['tests/guardrails-source.test.ts'])).toEqual([]);
});
