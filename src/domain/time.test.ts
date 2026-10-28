import { expect, test } from 'vitest';
import { formatDeadline, formatWhen } from './time.ts';

const when = (iso: string) => formatWhen(Temporal.Instant.from(iso));

test('formatWhen shows weekday, day, month and 12-hour time in plan time', () => {
  expect(when('2026-11-14T18:00:00Z')).toBe('Sat 14 Nov · 10:00 AM');
});

test('formatWhen drops the leading zero of the day', () => {
  expect(when('2026-11-09T17:00:00Z')).toBe('Mon 9 Nov · 9:00 AM');
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
