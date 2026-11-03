import { RATE_LIMITS } from '../config.ts';
import { localDateTime, localOn } from '../domain/time.ts';

export type RateRoute = keyof typeof RATE_LIMITS;
export type RateDecision = { limited: false } | { limited: true; retryAfterSeconds: number };
export type RateLimiter = { check(route: RateRoute, ip: string): RateDecision };

type Limits = {
  [R in RateRoute]: { perIp: { limit: number; windowSeconds: number }; perDay: { limit: number } };
};

type IpEntry = { windowEndsAt: Temporal.Instant; count: number };
type DayEntry = { date: string; resetsAt: Temporal.Instant; count: number };

function secondsUntil(now: Temporal.Instant, later: Temporal.Instant): number {
  const ms = later.epochMilliseconds - now.epochMilliseconds;
  return Math.max(1, Math.ceil(ms / 1000));
}

/** In-memory limiter: per IP in a window, and per route per local day. Every check counts, limited or not. */
export function createRateLimiter(now: () => Temporal.Instant, limits: Limits = RATE_LIMITS): RateLimiter {
  const ips = new Map<string, IpEntry>();
  const days = new Map<RateRoute, DayEntry>();

  return {
    check(route, ip) {
      const at = now();
      const config = limits[route];

      for (const [key, entry] of ips) {
        if (Temporal.Instant.compare(at, entry.windowEndsAt) >= 0) ips.delete(key);
      }

      const ipKey = `${route}:${ip}`;
      let ipEntry = ips.get(ipKey);
      if (!ipEntry) {
        ipEntry = {
          windowEndsAt: at.add({ seconds: config.perIp.windowSeconds }),
          count: 0,
        };
        ips.set(ipKey, ipEntry);
      }
      ipEntry.count += 1;

      const date = localDateTime(at).date;
      let dayEntry = days.get(route);
      if (!dayEntry || dayEntry.date !== date) {
        dayEntry = { date, resetsAt: localOn(at, 0, 1), count: 0 };
        days.set(route, dayEntry);
      }
      dayEntry.count += 1;

      const waits: number[] = [];
      if (ipEntry.count > config.perIp.limit) waits.push(secondsUntil(at, ipEntry.windowEndsAt));
      if (dayEntry.count > config.perDay.limit) waits.push(secondsUntil(at, dayEntry.resetsAt));
      if (waits.length === 0) return { limited: false };
      return { limited: true, retryAfterSeconds: Math.max(...waits) };
    },
  };
}
