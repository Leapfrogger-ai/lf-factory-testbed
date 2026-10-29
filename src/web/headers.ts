import type { MiddlewareHandler } from 'hono';
import { NONCE, secureHeaders } from 'hono/secure-headers';

const secure = secureHeaders({
  referrerPolicy: 'no-referrer',
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", NONCE],
    styleSrc: ["'self'"],
    imgSrc: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    baseUri: ["'none'"],
  },
});

export function responseHeaders(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path.startsWith('/static/')) return next();
    await secure(c, async () => {
      await next();
    });
    c.res.headers.set('Cache-Control', 'no-store');
    if (!(c.req.method === 'GET' && c.req.path === '/')) c.res.headers.set('X-Robots-Tag', 'noindex');
  };
}
