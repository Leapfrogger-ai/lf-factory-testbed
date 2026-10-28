import { localHour, localOn } from './time.ts';

const HOUR_MS = 3_600_000;

export type Schedule = {
  deadlineAt: string;
  reminder24At: string;
  reminderMorningAt: string | null;
  checkInAt: string;
};

export function computeSchedule(gatheringAt: Temporal.Instant, deadlineAt: Temporal.Instant): Schedule {
  return {
    deadlineAt: deadlineAt.toString(),
    reminder24At: gatheringAt.subtract({ hours: 24 }).toString(),
    reminderMorningAt: localHour(gatheringAt) < 10 ? null : localOn(gatheringAt, 8, 0).toString(),
    checkInAt: localOn(gatheringAt, 10, 1).toString(),
  };
}

export function defaultDeadline(now: Temporal.Instant, gatheringAt: Temporal.Instant): Temporal.Instant {
  const halfway = now.epochMilliseconds + (gatheringAt.epochMilliseconds - now.epochMilliseconds) / 2;
  const fortyEightBefore = gatheringAt.epochMilliseconds - 48 * HOUR_MS;
  const earliest = Math.min(fortyEightBefore, halfway);
  const chosen = earliest > now.epochMilliseconds ? earliest : halfway;
  return Temporal.Instant.fromEpochMilliseconds(chosen).round({ smallestUnit: 'minute', roundingMode: 'floor' });
}
