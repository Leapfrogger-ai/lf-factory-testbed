import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { runInTempProject } from './support/run-in-temp-project.ts';

const require = createRequire(import.meta.url);
const tscEntry = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
const repoRoot = resolve(import.meta.dirname, '..');
const repoTsconfig = join(repoRoot, 'tsconfig.json');
const typeRoots = [join(repoRoot, 'node_modules', '@types')];

const tsc = (files: Record<string, string>) =>
  runInTempProject(
    {
      // Mirror the repo: ESM, otherwise nodenext treats the files as CommonJS.
      'package.json': JSON.stringify({ type: 'module' }),
      'tsconfig.json': JSON.stringify({
        extends: repoTsconfig,
        // "types": ["node"] resolves from the temp dir here, so point typeRoots at the repo.
        compilerOptions: { typeRoots },
        include: ['*.ts'],
      }),
      ...files,
    },
    [process.execPath, tscEntry, '--noEmit'],
  );

test('clean file passes', () => {
  const result = tsc({ 'a.ts': 'export const a: number = 1;' });
  expect(result.status, result.output).toBe(0);
});

test('type error fails', () => {
  const result = tsc({ 'a.ts': "export const a: number = 'x';" });
  expect(result.status).not.toBe(0);
  expect(result.output).toContain('TS2322');
});

test('enum fails under erasableSyntaxOnly', () => {
  const result = tsc({ 'a.ts': 'export enum Color { Red }' });
  expect(result.status).not.toBe(0);
  expect(result.output).toContain('TS1294');
});
