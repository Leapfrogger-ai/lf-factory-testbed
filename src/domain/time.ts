export const PLAN_TIME_ZONE = 'America/Los_Angeles';

/** `date` is YYYY-MM-DD, `time` is HH:MM, both wall-clock in PLAN_TIME_ZONE. */
export function localToInstant(date: string, time: string): Temporal.Instant {
  return Temporal.PlainDateTime.from(`${date}T${time}`)
    .toZonedDateTime(PLAN_TIME_ZONE, { disambiguation: 'compatible' })
    .toInstant();
}

const display = new Intl.DateTimeFormat('en-US', {
  timeZone: PLAN_TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function displayParts(instant: Temporal.Instant) {
  const parts: Record<string, string> = {};
  for (const { type, value } of display.formatToParts(new Date(instant.epochMilliseconds))) {
    parts[type] = value.replace(/[  ]/g, ' ');
  }
  return {
    day: `${parts.weekday} ${parts.day} ${parts.month}`,
    clock: `${Number(parts.hour) % 12 || 12}:${parts.minute} ${parts.dayPeriod}`,
  };
}

/** UX §8.8 day part, e.g. `Sat 14 Nov`, in PLAN_TIME_ZONE. */
export function formatDay(instant: Temporal.Instant): string {
  return displayParts(instant).day;
}

/** UX §8.8 clock part, e.g. `10:00 AM`, in PLAN_TIME_ZONE. */
export function formatClock(instant: Temporal.Instant): string {
  return displayParts(instant).clock;
}

/** UX §8.8 event time, e.g. `Sat 14 Nov · 10:00 AM`, in PLAN_TIME_ZONE. */
export function formatWhen(instant: Temporal.Instant): string {
  const { day, clock } = displayParts(instant);
  return `${day} · ${clock}`;
}

/** Share-message time, e.g. `Sat 14 Nov 10:00 AM`, in PLAN_TIME_ZONE. */
export function formatShareWhen(instant: Temporal.Instant): string {
  const { day, clock } = displayParts(instant);
  return `${day} ${clock}`;
}

/** UX §8.8 commit deadline, e.g. `Wed 11 Nov, 10:00 PM`, in PLAN_TIME_ZONE. */
export function formatDeadline(instant: Temporal.Instant): string {
  const { day, clock } = displayParts(instant);
  return `${day}, ${clock}`;
}

/**
 * Relative commit-deadline hint, the text inside the brackets, e.g. `in 5 hours` or `tomorrow`.
 * Under 24 real hours it counts hours; beyond that it counts calendar days in PLAN_TIME_ZONE.
 */
export function formatDeadlineHint(deadline: Temporal.Instant, now: Temporal.Instant): string {
  const hours = Math.floor(now.until(deadline, { largestUnit: 'hour' }).total('hour'));
  const hoursText = hours === 1 ? 'in 1 hour' : `in ${hours} hours`;
  if (hours < 1) return 'in under an hour';
  if (hours < 24) return hoursText;
  const days = now
    .toZonedDateTimeISO(PLAN_TIME_ZONE)
    .toPlainDate()
    .until(deadline.toZonedDateTimeISO(PLAN_TIME_ZONE).toPlainDate(), { largestUnit: 'day' }).days;
  if (days === 0) return hoursText;
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

/** The wall-clock hour (0-23) of the instant in PLAN_TIME_ZONE. */
export function localHour(instant: Temporal.Instant): number {
  return instant.toZonedDateTimeISO(PLAN_TIME_ZONE).hour;
}

/** The wall-clock date (YYYY-MM-DD) and time (HH:MM) of the instant in PLAN_TIME_ZONE. */
export function localDateTime(instant: Temporal.Instant): { date: string; time: string } {
  const local = instant.toZonedDateTimeISO(PLAN_TIME_ZONE);
  return {
    date: local.toPlainDate().toString(),
    time: local.toPlainTime().toString({ smallestUnit: 'minute' }),
  };
}

/** The `hour`:00 wall-clock in PLAN_TIME_ZONE, `dayOffset` days after the instant's local date. */
export function localOn(instant: Temporal.Instant, hour: number, dayOffset: number): Temporal.Instant {
  return instant
    .toZonedDateTimeISO(PLAN_TIME_ZONE)
    .startOfDay()
    .add({ days: dayOffset })
    .with({ hour, minute: 0, second: 0 })
    .toInstant();
}
