import { describe, expect, test } from 'vitest';
import { formatClock, formatDay, formatDeadline, formatDeadlineHint, formatShareWhen, formatWhen, localDateTime } from './time.ts';

const when = (iso: string) => formatWhen(Temporal.Instant.from(iso));
const day = (iso: string) => formatDay(Temporal.Instant.from(iso));

test('formatWhen shows weekday, day, month and 12-hour time in plan time', () => {
  expect(when('2026-11-14T18:00:00Z')).toBe('Sat 14 Nov · 10:00 AM');
});

test('formatWhen drops the leading zero of the day', () => {
  expect(when('2026-11-09T17:00:00Z')).toBe('Mon 9 Nov · 9:00 AM');
});

test('formatShareWhen joins the day and the 12-hour clock with a space', () => {
  expect(formatShareWhen(Temporal.Instant.from('2026-11-14T18:00:00Z'))).toBe('Sat 14 Nov 10:00 AM');
});

test('formatShareWhen is right on the 2026-11-01 fall-back day', () => {
  expect(formatShareWhen(Temporal.Instant.from('2026-11-01T09:30:00Z'))).toBe('Sun 1 Nov 1:30 AM');
});

test('formatDeadline uses a comma before the time', () => {
  expect(formatDeadline(Temporal.Instant.from('2026-11-12T06:00:00Z'))).toBe('Wed 11 Nov, 10:00 PM');
});

test('formatWhen is right across the 2026-11-01 fall-back, including the repeated hour', () => {
  expect([when('2026-11-01T08:30:00Z'), when('2026-11-01T09:30:00Z')]).toEqual([
    'Sun 1 Nov · 1:30 AM',
    'Sun 1 Nov · 1:30 AM',
  ]);
});

test('formatWhen is right across the 2027-03-14 spring-forward', () => {
  expect([when('2027-03-14T09:59:00Z'), when('2027-03-14T10:00:00Z')]).toEqual([
    'Sun 14 Mar · 1:59 AM',
    'Sun 14 Mar · 3:00 AM',
  ]);
});

test('formatWhen shows noon as 12:00 PM', () => {
  expect(when('2026-11-14T20:00:00Z')).toBe('Sat 14 Nov · 12:00 PM');
});

test('formatDeadline shows midnight as 12:00 AM', () => {
  expect(formatDeadline(Temporal.Instant.from('2026-11-12T08:00:00Z'))).toBe('Thu 12 Nov, 12:00 AM');
});

const local = (iso: string) => localDateTime(Temporal.Instant.from(iso));

test('localDateTime gives the plan-time date and wall clock', () => {
  expect(local('2026-11-14T18:00:00Z')).toEqual({ date: '2026-11-14', time: '10:00' });
});

test('localDateTime is right across the 2026-11-01 fall-back, including the repeated hour', () => {
  expect([local('2026-11-01T08:30:00Z'), local('2026-11-01T09:30:00Z')]).toEqual([
    { date: '2026-11-01', time: '01:30' },
    { date: '2026-11-01', time: '01:30' },
  ]);
});

test('localDateTime is right across the 2027-03-14 spring-forward', () => {
  expect([local('2027-03-14T09:30:00Z'), local('2027-03-14T10:30:00Z')]).toEqual([
    { date: '2027-03-14', time: '01:30' },
    { date: '2027-03-14', time: '03:30' },
  ]);
});

describe('formatDay', () => {
  test('shows weekday, day and month in plan time', () => {
    expect(day('2026-11-14T18:00:00Z')).toBe('Sat 14 Nov');
  });

  test('is right across the 2026-11-01 fall-back, including the repeated hour', () => {
    expect([day('2026-11-01T08:30:00Z'), day('2026-11-01T09:30:00Z')]).toEqual([
      'Sun 1 Nov',
      'Sun 1 Nov',
    ]);
  });

  test('is right across the 2027-03-14 spring-forward', () => {
    expect(day('2027-03-14T11:00:00Z')).toBe('Sun 14 Mar');
  });

  test('uses the plan-time date when the UTC date has already rolled over', () => {
    expect(day('2026-11-15T07:30:00Z')).toBe('Sat 14 Nov');
  });
});

test.each([
  ['2026-11-14T18:00:00Z', '10:00 AM'],
  ['2026-11-14T21:30:00Z', '1:30 PM'],
  ['2026-11-01T18:00:00Z', '10:00 AM'],
  ['2027-03-14T18:00:00Z', '11:00 AM'],
])('formatClock of %s is %s in plan time', (iso, expected) => {
  expect(formatClock(Temporal.Instant.from(iso))).toBe(expected);
});

describe('formatDeadlineHint', () => {
  const hint = (now: string, deadline: string) =>
    formatDeadlineHint(Temporal.Instant.from(deadline), Temporal.Instant.from(now));

  test('counts calendar days for 48 h away (AC3)', () => {
    expect(hint('2026-11-10T18:00:00Z', '2026-11-12T18:00:00Z')).toBe('in 2 days');
  });

  test.each([
    ['25 h, local dates 11 to 12', '2026-11-11T17:00:00Z', '2026-11-12T18:00:00Z', 'tomorrow'],
    ['5 h', '2026-11-12T13:00:00Z', '2026-11-12T18:00:00Z', 'in 5 hours'],
    ['30 min', '2026-11-12T17:30:00Z', '2026-11-12T18:00:00Z', 'in under an hour'],
    ['59 min 59 s', '2026-11-12T17:00:01Z', '2026-11-12T18:00:00Z', 'in under an hour'],
    ['exactly 60 min', '2026-11-12T17:00:00Z', '2026-11-12T18:00:00Z', 'in 1 hour'],
    ['4 h 30 min rounds down', '2026-11-12T13:30:00Z', '2026-11-12T18:00:00Z', 'in 4 hours'],
    ['exactly 24 h, dates 11 to 12', '2026-11-11T18:00:00Z', '2026-11-12T18:00:00Z', 'tomorrow'],
    ['34 h, local dates 10 to 12', '2026-11-11T07:00:00Z', '2026-11-12T09:00:00Z', 'in 2 days'],
    ['fall back, 24 h elapsed, same local date', '2026-11-01T07:30:00Z', '2026-11-02T07:30:00Z', 'in 24 hours'],
    ['25 h across 2026-11-01, dates 31 Oct to 1 Nov', '2026-10-31T17:00:00Z', '2026-11-01T18:00:00Z', 'tomorrow'],
    ['spring forward 2027-03-14, 22.5 h real', '2027-03-13T17:30:00Z', '2027-03-14T16:00:00Z', 'in 22 hours'],
  ])('%s', (_why, now, deadline, expected) => {
    expect(hint(now, deadline)).toBe(expected);
  });
});

test('no output contains a narrow or no-break space', () => {
  const outputs = [
    when('2026-11-14T18:00:00Z'),
    when('2026-11-14T23:00:00Z'),
    formatDeadline(Temporal.Instant.from('2026-11-12T06:00:00Z')),
  ];
  for (const text of outputs) {
    expect(text).not.toMatch(/[  ]/);
  }
});
