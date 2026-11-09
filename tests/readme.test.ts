import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const text = readFileSync('README.md', 'utf8');
const lines = text.split('\n');

test('readme description line ends with the app sentence', () => {
  expect(lines[2].startsWith("The factory's testbed.")).toBe(true);
  expect(lines[2].endsWith('. Home of calvin, the small-gatherings app.')).toBe(true);
});

test('readme keeps its title and three-line shape', () => {
  expect(lines[0]).toBe('# lf-factory-testbed');
  expect(lines[1]).toBe('');
  expect(text.replace(/\n$/, '').split('\n').length).toBe(3);
});
