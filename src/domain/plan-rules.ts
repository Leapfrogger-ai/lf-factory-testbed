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
  const nowNs = now.epochNanoseconds;
  const halfway = nowNs + (gatheringAt.epochNanoseconds - nowNs) / 2n;
  const fortyEightBefore = gatheringAt.epochNanoseconds - BigInt(48 * HOUR_MS) * 1_000_000n;
  const earliest = fortyEightBefore < halfway ? fortyEightBefore : halfway;
  const chosen = earliest > nowNs ? earliest : halfway;
  return Temporal.Instant.fromEpochNanoseconds(chosen).round({ smallestUnit: 'minute', roundingMode: 'floor' });
}
