import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const pkg = JSON.parse(read('package.json'));

test('package is an ESM project on Node 26', () => {
  expect(pkg.type).toBe('module');
  expect(pkg.engines.node).toBe('>=26');
});

test('versions that must not drift are pinned exactly', () => {
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  const temporal = Object.entries(all).filter(([name]) => name.startsWith('@temporalio/'));
  expect(temporal.length).toBeGreaterThan(0);
  for (const [, version] of temporal) expect(version).toBe('1.24.0');
  expect(pkg.devDependencies['embedded-postgres']).toBe('17.10.0-beta.17');
  expect(pkg.dependencies['drizzle-orm']).toBe('0.45.4');
});

test('.gitignore keeps run state and dependencies out of git', () => {
  const lines = read('.gitignore').split('\n').map((l) => l.trim());
  expect(lines).toContain('.factory/');
  expect(lines).toContain('node_modules/');
});

test('tsconfig sets the flags for native type stripping', () => {
  const { compilerOptions } = JSON.parse(read('tsconfig.json'));
  for (const flag of ['strict', 'erasableSyntaxOnly', 'verbatimModuleSyntax', 'allowImportingTsExtensions', 'noEmit']) {
    expect(compilerOptions[flag]).toBe(true);
  }
});
