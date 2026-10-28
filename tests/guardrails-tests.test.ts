import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { runInTempProject } from './support/run-in-temp-project.ts';

const require = createRequire(import.meta.url);
const vitestEntry = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

// No config in the temp project, so the repo's vitest config is not picked up.
const vitestRun = (body: string) =>
  runInTempProject(
    { 'sample.test.ts': `import { expect, it } from 'vitest';\nit('sample', () => { ${body} });\n` },
    [process.execPath, vitestEntry, 'run'],
  );

test('passing test exits 0', { timeout: 60_000 }, () => {
  const result = vitestRun('expect(1).toBe(1);');
  expect(result.status, result.output).toBe(0);
});

test('failing test exits non-zero', { timeout: 60_000 }, () => {
  const result = vitestRun('expect(1).toBe(2);');
  expect(result.status).not.toBe(0);
  expect(result.output).toContain('FAIL');
});
