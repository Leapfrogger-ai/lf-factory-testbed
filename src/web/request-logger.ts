import type { MiddlewareHandler } from 'hono';
import { log } from '../log.ts';

/** Replaces the first segment after /p/, /m/, /w/, /c/ with :token. */
export function redactPath(path: string): string {
  return path.replace(/^\/([pmwc])\/[^/]*/, '/$1/:token');
}

export function requestLogger(): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    const requestId = crypto.randomUUID();
    await next();
    if (c.req.path === '/healthz') return;
    log.info('request', {
      requestId,
      method: c.req.method,
      path: redactPath(c.req.path),
      status: c.res.status,
      durationMs: Math.round(performance.now() - start),
    });
  };
}
