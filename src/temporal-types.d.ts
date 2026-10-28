// Node 26 ships Temporal at runtime, but neither @types/node nor TypeScript's lib
// declare it yet. Declare only the members the code uses.
declare namespace Temporal {
  interface DurationLike {
    hours?: number;
    days?: number;
    minutes?: number;
  }

  interface Instant {
    readonly epochMilliseconds: number;
    readonly epochNanoseconds: bigint;
    toString(): string;
    add(duration: DurationLike): Instant;
    subtract(duration: DurationLike): Instant;
    round(options: { smallestUnit: 'minute'; roundingMode: 'floor' }): Instant;
    toZonedDateTimeISO(timeZone: string): ZonedDateTime;
  }

  interface PlainDate {
    readonly year: number;
    readonly month: number;
    readonly day: number;
  }

  interface PlainDateTime {
    toZonedDateTime(
      timeZone: string,
      options?: { disambiguation: 'compatible' | 'earlier' | 'later' | 'reject' },
    ): ZonedDateTime;
  }

  interface ZonedDateTime {
    readonly hour: number;
    toInstant(): Instant;
    toPlainDate(): PlainDate;
    add(duration: DurationLike): ZonedDateTime;
    startOfDay(): ZonedDateTime;
    with(fields: { hour?: number; minute?: number; second?: number }): ZonedDateTime;
  }
}

declare const Temporal: {
  Instant: {
    from(item: string): Temporal.Instant;
    fromEpochNanoseconds(ns: bigint): Temporal.Instant;
  };
  PlainDateTime: {
    from(item: string): Temporal.PlainDateTime;
  };
};
