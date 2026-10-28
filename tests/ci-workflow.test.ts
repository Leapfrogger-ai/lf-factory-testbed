import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);

describe('CI workflow', () => {
  it('runs on pull requests to main', () => {
    expect(workflow).toContain('pull_request');
    expect(workflow).toContain('main');
  });

  it('defines a job keyed ci on ubuntu-latest', () => {
    expect(workflow).toContain('ci:');
    expect(workflow).toContain('runs-on: ubuntu-latest');
  });

  it('pins Node 26 with full checkout history', () => {
    expect(workflow).toContain('node-version: 26');
    expect(workflow).toContain('fetch-depth: 0');
  });

  it('sets the test database name', () => {
    expect(workflow).toContain('FACTORY_DB_NAME: calvin_test');
  });

  it('runs npm ci, typecheck, then tests in that order', () => {
    const steps = ['npm ci', 'npx tsc --noEmit', 'npx vitest run'];
    const positions = steps.map((step) => workflow.indexOf(step));
    for (const position of positions) {
      expect(position).toBeGreaterThanOrEqual(0);
    }
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('uses no services and no secrets', () => {
    expect(workflow).not.toContain('services:');
    expect(workflow).not.toContain('secrets.');
  });
});
