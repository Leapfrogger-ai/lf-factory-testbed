import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const text = readFileSync('README.md', 'utf8');
const lines = text.split(/\r?\n/);

test('readme description line ends with the app sentence', () => {
  expect(lines[2]).toMatch(/^The factory's testbed\./);
  expect(lines[2]).toMatch(/\. Home of calvin, the small-gatherings app\.$/);
});

test('readme keeps its title and three-line shape', () => {
  expect(lines[0]).toBe('# lf-factory-testbed');
  expect(lines[1]).toBe('');
  expect(text.replace(/\r?\n$/, '').split(/\r?\n/).length).toBe(3);
});
