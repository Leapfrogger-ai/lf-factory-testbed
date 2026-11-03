import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';

/** The caller's IP: Fly's header, else the socket's address, else 'unknown' (one shared key). */
export function clientIp(c: Context): string {
  const forwarded = c.req.header('Fly-Client-IP')?.trim();
  if (forwarded) return forwarded;
  try {
    const address = getConnInfo(c).remote.address;
    if (address) return address;
  } catch {
    // No socket, as under app.request() in tests.
  }
  return 'unknown';
}
