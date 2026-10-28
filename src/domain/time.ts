export const PLAN_TIME_ZONE = 'America/Los_Angeles';

/** `date` is YYYY-MM-DD, `time` is HH:MM, both wall-clock in PLAN_TIME_ZONE. */
export function localToInstant(date: string, time: string): Temporal.Instant {
  return Temporal.PlainDateTime.from(`${date}T${time}`)
    .toZonedDateTime(PLAN_TIME_ZONE, { disambiguation: 'compatible' })
    .toInstant();
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
