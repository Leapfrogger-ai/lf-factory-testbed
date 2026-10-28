import { expect, test } from 'vitest';
import { CITIES } from '../config.ts';
import { publishFormSchema } from './forms.ts';

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

test('CITIES starts with San Francisco and has 15 cities', () => {
  expect(CITIES[0]).toBe('San Francisco');
  expect(CITIES.length).toBe(15);
});
