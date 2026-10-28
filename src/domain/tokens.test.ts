import { expect, test } from 'vitest';
import { isToken, newToken } from './tokens.ts';

test('isToken accepts exactly 43 base64url characters', () => {
  expect([isToken(newToken()), isToken('short'), isToken('a'.repeat(44)), isToken(`${'a'.repeat(42)}!`)]).toEqual([
    true,
    false,
    false,
    false,
  ]);
});

test('newToken returns 43 base64url characters, all different', () => {
  const tokens = Array.from({ length: 1000 }, () => newToken());
  for (const token of tokens) {
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  }
  expect(new Set(tokens).size).toBe(1000);
});
