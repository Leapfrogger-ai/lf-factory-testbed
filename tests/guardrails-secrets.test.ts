import { spawnSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { runInTempProject } from './support/run-in-temp-project.ts';

const hasGitleaks = spawnSync('gitleaks', ['version']).status === 0;

// Built at runtime from parts so no single literal in this file looks like a secret.
// Shape: GitHub personal access token, prefix + 36 alphanumerics.
const secret = ['ghp', '_', 'q8Zk3Vn1Rw7T', 'yL5mXc0BdE9u', 'Ha2JsPf4GoNi'].join('');

const commitAndScan = [
  'sh',
  '-c',
  'git init -q && git add . && git -c user.email=t@t -c user.name=t -c commit.gpgsign=false commit -qm x && gitleaks git --redact --exit-code 1',
];

describe.skipIf(!hasGitleaks)('gitleaks', () => {
  test('clean commit passes', { timeout: 60_000 }, () => {
    const result = runInTempProject({ 'a.txt': 'hello' }, commitAndScan);
    expect(result.status, result.output).toBe(0);
  });

  test('commit with a secret fails and is redacted', { timeout: 60_000 }, () => {
    const result = runInTempProject(
      { 'config.ts': `export const token = '${secret}';\n` },
      commitAndScan,
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain('REDACTED');
    expect(result.output).not.toContain(secret);
  });
});
