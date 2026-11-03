import { describe, expect, test } from 'vitest';
import { CITIES } from '../config.ts';
import { commitFormSchema, publishFormSchema, suggestFormSchema } from './forms.ts';

const valid = {
  city: 'Oakland',
  area: 'Lake Merritt',
  timeWindow: 'Saturday morning',
  format: 'coffee',
  venue: 'Blue Bottle',
  date: '2026-11-14',
  time: '10:00',
  minimum: '3',
  deadlineDate: '',
  deadlineTime: '',
  name: 'Ann',
  email: 'ann@example.test',
};

test('a valid body parses with a numeric minimum and no deadline', () => {
  const form = publishFormSchema.parse(valid);
  expect(form.minimum).toBe(3);
  expect(form.deadlineDate).toBeUndefined();
});

test('the email is trimmed and also given in lowercase', () => {
  const form = publishFormSchema.parse({ ...valid, email: '  Ann@Example.TEST ' });
  expect(form.email).toBe('Ann@Example.TEST');
  expect(form.emailNormalized).toBe('ann@example.test');
});

test.each(['1', '2.5', '3000000000'])('a minimum of %s is rejected', (minimum) => {
  expect(publishFormSchema.safeParse({ ...valid, minimum }).success).toBe(false);
});

test('a city outside the list is rejected', () => {
  expect(publishFormSchema.safeParse({ ...valid, city: 'Gotham' }).success).toBe(false);
});

test('a date that does not exist is rejected', () => {
  expect(publishFormSchema.safeParse({ ...valid, date: '2026-02-30' }).success).toBe(false);
});

test('a deadline date without a deadline time is an issue on the deadline time', () => {
  const result = publishFormSchema.safeParse({ ...valid, deadlineDate: '2026-11-12' });
  expect(result.success).toBe(false);
  expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['deadlineTime']);
});

test('a deadline time without a deadline date is an issue on the deadline date', () => {
  const result = publishFormSchema.safeParse({ ...valid, deadlineTime: '18:00' });
  expect(result.success).toBe(false);
  expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['deadlineDate']);
});

test('a whitespace-only text field is rejected', () => {
  expect(publishFormSchema.safeParse({ ...valid, venue: '   ' }).success).toBe(false);
});

test('a time of 24:00 is rejected', () => {
  expect(publishFormSchema.safeParse({ ...valid, time: '24:00' }).success).toBe(false);
});

test('a deadline date and time together parse', () => {
  const form = publishFormSchema.parse({ ...valid, deadlineDate: '2026-11-12', deadlineTime: '18:00' });
  expect(form.deadlineDate).toBe('2026-11-12');
  expect(form.deadlineTime).toBe('18:00');
});

test('a blank suggestionId parses to undefined and a given one is trimmed', () => {
  expect(publishFormSchema.parse({ ...valid, suggestionId: '  ' }).suggestionId).toBeUndefined();
  expect(publishFormSchema.parse(valid).suggestionId).toBeUndefined();
  expect(publishFormSchema.parse({ ...valid, suggestionId: ' abc ' }).suggestionId).toBe('abc');
});

test('a suggest body is trimmed', () => {
  const form = suggestFormSchema.parse({ city: 'Oakland', area: '  Rockridge ', timeWindow: ' next weekend, morning  ' });
  expect(form).toEqual({ city: 'Oakland', area: 'Rockridge', timeWindow: 'next weekend, morning' });
});

test('a suggest body with a city outside the list is rejected', () => {
  expect(suggestFormSchema.safeParse({ city: 'Gotham', area: 'Rockridge', timeWindow: 'soon' }).success).toBe(false);
});

describe('commitFormSchema', () => {
  test('parses a padded mixed-case email into email and emailNormalized', () => {
    expect(commitFormSchema.parse({ name: ' Mia Chen ', email: ' MIA@Example.test ' })).toEqual({
      name: 'Mia Chen',
      email: 'MIA@Example.test',
      emailNormalized: 'mia@example.test',
    });
  });

  test('rejects an empty name', () => {
    const result = commitFormSchema.safeParse({ name: '  ', email: 'mia@example.test' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['name']]);
  });

  test('rejects the email "mia@"', () => {
    const result = commitFormSchema.safeParse({ name: 'Mia', email: 'mia@' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['email']]);
  });

  test('rejects a name over 80 characters', () => {
    const result = commitFormSchema.safeParse({ name: 'a'.repeat(81), email: 'mia@example.test' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['name']]);
  });
});

test('CITIES starts with San Francisco and has 15 cities', () => {
  expect(CITIES[0]).toBe('San Francisco');
  expect(CITIES.length).toBe(15);
});
