import { describe, expect, test } from 'vitest';
import { fixedClock } from '../../tests/support/fakes.ts';
import { createRateLimiter } from './rate-limit.ts';

const limits = {
  suggest: { perIp: { limit: 2, windowSeconds: 600 }, perDay: { limit: 100 } },
  publish: { perIp: { limit: 2, windowSeconds: 600 }, perDay: { limit: 100 } },
} as const;

describe('createRateLimiter', () => {
  test('allows the limit and refuses the next', () => {
    const limiter = createRateLimiter(fixedClock('2026-11-09T18:00:00Z'), limits);
    expect(limiter.check('suggest', '1.1.1.1')).toEqual({ limited: false });
    expect(limiter.check('suggest', '1.1.1.1')).toEqual({ limited: false });
    expect(limiter.check('suggest', '1.1.1.1')).toEqual({ limited: true, retryAfterSeconds: 600 });
  });

  test('rounds Retry-After up to a whole second', () => {
    let at = fixedClock('2026-11-09T18:00:00.000Z')();
    const limiter = createRateLimiter(() => at, limits);
    limiter.check('suggest', '1.1.1.1');
    limiter.check('suggest', '1.1.1.1');
    at = fixedClock('2026-11-09T18:00:00.250Z')();
    expect(limiter.check('suggest', '1.1.1.1')).toEqual({ limited: true, retryAfterSeconds: 600 });
  });

  test('counts another IP separately', () => {
    const limiter = createRateLimiter(fixedClock('2026-11-09T18:00:00Z'), limits);
    limiter.check('suggest', '1.1.1.1');
    limiter.check('suggest', '1.1.1.1');
    expect(limiter.check('suggest', '1.1.1.1').limited).toBe(true);
    expect(limiter.check('suggest', '2.2.2.2')).toEqual({ limited: false });
  });

  test('starts a new window at the reset instant', () => {
    let at = fixedClock('2026-11-09T18:00:00Z')();
    const limiter = createRateLimiter(() => at, limits);
    limiter.check('suggest', '1.1.1.1');
    limiter.check('suggest', '1.1.1.1');
    expect(limiter.check('suggest', '1.1.1.1').limited).toBe(true);
    at = fixedClock('2026-11-09T18:10:00Z')();
    expect(limiter.check('suggest', '1.1.1.1')).toEqual({ limited: false });
  });

  test.each(['suggest', 'publish'] as const)('caps %s per day across IPs', (route) => {
    const other = route === 'suggest' ? 'publish' : 'suggest';
    const dayLimits = {
      suggest: { perIp: { limit: 100, windowSeconds: 600 }, perDay: { limit: 3 } },
      publish: { perIp: { limit: 100, windowSeconds: 600 }, perDay: { limit: 3 } },
    } as const;
    const limiter = createRateLimiter(fixedClock('2026-11-09T18:00:00Z'), dayLimits);
    expect(limiter.check(route, '1.1.1.1').limited).toBe(false);
    expect(limiter.check(route, '2.2.2.2').limited).toBe(false);
    expect(limiter.check(route, '3.3.3.3').limited).toBe(false);
    expect(limiter.check(route, '4.4.4.4').limited).toBe(true);
    expect(limiter.check(other, '4.4.4.4')).toEqual({ limited: false });
  });

  const exhaustDay = (iso: string) => {
    let at = fixedClock(iso)();
    const dayLimits = {
      suggest: { perIp: { limit: 100, windowSeconds: 600 }, perDay: { limit: 1 } },
      publish: { perIp: { limit: 100, windowSeconds: 600 }, perDay: { limit: 1 } },
    } as const;
    const limiter = createRateLimiter(() => at, dayLimits);
    limiter.check('suggest', '1.1.1.1');
    return { limiter, refused: () => limiter.check('suggest', '2.2.2.2'), setNow: (next: string) => (at = fixedClock(next)()) };
  };

  test('rolls the day over at Los Angeles midnight', () => {
    const { refused, limiter, setNow } = exhaustDay('2026-11-09T07:30:00Z');
    expect(refused()).toEqual({ limited: true, retryAfterSeconds: 1800 });
    setNow('2026-11-09T08:00:00Z');
    expect(limiter.check('suggest', '3.3.3.3')).toEqual({ limited: false });
  });

  test('a day is 25 hours when the clocks fall back', () => {
    const { refused } = exhaustDay('2026-11-01T07:00:00Z');
    expect(refused()).toEqual({ limited: true, retryAfterSeconds: 90000 });
  });

  test('a day is 23 hours when the clocks spring forward', () => {
    const { refused } = exhaustDay('2027-03-14T08:00:00Z');
    expect(refused()).toEqual({ limited: true, retryAfterSeconds: 82800 });
  });
});
