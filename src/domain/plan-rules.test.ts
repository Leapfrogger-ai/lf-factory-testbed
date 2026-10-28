import { expect, test } from 'vitest';
import { computeSchedule, defaultDeadline } from './plan-rules.ts';
import { localToInstant } from './time.ts';

const at = (iso: string) => Temporal.Instant.from(iso);

test('default deadline is 48h before the gathering when that is before the halfway point', () => {
  const deadline = defaultDeadline(at('2026-11-09T18:00:00Z'), at('2026-11-14T18:00:00Z'));
  expect(deadline.toString()).toBe('2026-11-12T06:00:00Z');
});

test('default deadline is 48h before the gathering when now is exactly 72h before it', () => {
  const deadline = defaultDeadline(at('2026-11-11T18:00:00Z'), at('2026-11-14T18:00:00Z'));
  expect(deadline.toString()).toBe('2026-11-12T18:00:00Z');
});

test('default deadline is the halfway point when 48h before the gathering is already past', () => {
  const deadline = defaultDeadline(at('2026-11-13T18:00:00Z'), at('2026-11-14T18:00:00Z'));
  expect(deadline.toString()).toBe('2026-11-14T06:00:00Z');
});

test('localToInstant reads the wall-clock in America/Los_Angeles', () => {
  expect(localToInstant('2026-11-13', '18:00').toString()).toBe('2026-11-14T02:00:00Z');
  expect(localToInstant('2026-11-14', '10:00').toString()).toBe('2026-11-14T18:00:00Z');
});

test('computeSchedule gives the deadline, 24h reminder, morning reminder and check-in', () => {
  expect(computeSchedule(at('2026-11-14T18:00:00Z'), at('2026-11-12T06:00:00Z'))).toEqual({
    deadlineAt: '2026-11-12T06:00:00Z',
    reminder24At: '2026-11-13T18:00:00Z',
    reminderMorningAt: '2026-11-14T16:00:00Z',
    checkInAt: '2026-11-15T18:00:00Z',
  });
});

test('computeSchedule skips the morning reminder when the gathering starts before 10:00 local', () => {
  const schedule = computeSchedule(localToInstant('2026-11-14', '09:30'), at('2026-11-12T06:00:00Z'));
  expect(schedule.reminderMorningAt).toBeNull();
});

test('computeSchedule on the fall-back day keeps local reminder and check-in times', () => {
  expect(computeSchedule(at('2026-11-01T18:00:00Z'), at('2026-10-30T06:00:00Z'))).toMatchObject({
    reminder24At: '2026-10-31T18:00:00Z',
    reminderMorningAt: '2026-11-01T16:00:00Z',
    checkInAt: '2026-11-02T18:00:00Z',
  });
});

test('computeSchedule on the spring-forward day keeps local reminder and check-in times', () => {
  expect(computeSchedule(at('2027-03-14T17:00:00Z'), at('2027-03-12T06:00:00Z'))).toMatchObject({
    reminder24At: '2027-03-13T17:00:00Z',
    reminderMorningAt: '2027-03-14T15:00:00Z',
    checkInAt: '2027-03-15T17:00:00Z',
  });
});

test('localToInstant returns an instant for a nonexistent and a repeated wall-clock time', () => {
  expect(() => localToInstant('2027-03-14', '02:30')).not.toThrow();
  expect(() => localToInstant('2026-11-01', '01:30')).not.toThrow();
});
