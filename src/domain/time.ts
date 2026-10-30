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

/** UX §8.8 event time, e.g. `Sat 14 Nov · 10:00 AM`, in PLAN_TIME_ZONE. */
export function formatWhen(instant: Temporal.Instant): string {
  const { day, clock } = displayParts(instant);
  return `${day} · ${clock}`;
}

/** UX §8.8 commit deadline, e.g. `Wed 11 Nov, 10:00 PM`, in PLAN_TIME_ZONE. */
export function formatDeadline(instant: Temporal.Instant): string {
  const { day, clock } = displayParts(instant);
  return `${day}, ${clock}`;
}

/** The wall-clock hour (0-23) of the instant in PLAN_TIME_ZONE. */
export function localHour(instant: Temporal.Instant): number {
  return instant.toZonedDateTimeISO(PLAN_TIME_ZONE).hour;
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
