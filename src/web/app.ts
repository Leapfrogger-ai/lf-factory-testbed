import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import type { Db } from '../db/client.ts';
import type { Schedule } from '../domain/plan-rules.ts';
import type { SendEmail } from '../email/send-email.ts';
import { log } from '../log.ts';
import type { SuggestPlanCall } from '../suggest/suggest.ts';
import { responseHeaders } from './headers.ts';
import { publicRoutes } from './routes/public.ts';
import { createRateLimiter } from './rate-limit.ts';
import { requestLogger } from './request-logger.ts';
import { createRoutes } from './routes/create.ts';
import { manageRoutes } from './routes/manage.ts';
import { layout } from './views/layout.ts';
import { notFoundPage } from './views/not-found-page.ts';
import { systemErrorPage } from './views/system-error-page.ts';

export type { Db };

// Placeholders that later stories narrow.
export type AppDeps = {
  db: Db;
  now: () => Temporal.Instant;
  suggestPlanCall: SuggestPlanCall;
  sendEmail: SendEmail;
  planWorkflows: {
    start(planId: string, schedule: Schedule): Promise<void>;
    signal(planId: string, signal: string, arg?: unknown): Promise<void>;
  };
};

export type AppConfig = { baseUrl: string; anthropicModel?: string };

export function createApp(deps: AppDeps, config: AppConfig): Hono {
  const app = new Hono();
  app.use('*', requestLogger());
  app.use('*', responseHeaders());
  app.post('*', csrf({ origin: config.baseUrl }));
  app.post(
    '*',
    bodyLimit({
      maxSize: 16 * 1024,
      onError: (c) => {
        log.warn('body too large');
        return c.html(layout('Something went wrong', systemErrorPage(), { noindex: true }), 413);
      },
    }),
  );
  app.get('/healthz', (c) => c.text('ok'));
  app.use('/static/*', async (c, next) => {
    await next();
    if (c.res.status === 200) c.res.headers.set('Cache-Control', 'public, max-age=86400');
  });
  app.use('/static/*', serveStatic({ root: './public', rewriteRequestPath: (path) => path.replace(/^\/static/, '') }));
  app.route('/', createRoutes(deps, config, createRateLimiter(deps.now)));
  app.route('/', manageRoutes(deps, config));
  app.route('/', publicRoutes(deps, config));
  app.onError((err, c) => {
    if (err instanceof HTTPException && err.status === 403) {
      log.warn('csrf rejected');
      return c.html(layout('Something went wrong', systemErrorPage(), { noindex: true }), 403);
    }
    log.error('unexpected error', { errorName: err.name });
    return c.html(layout('Something went wrong', systemErrorPage(), { noindex: true }), 500);
  });
  app.notFound((c) => c.html(layout('Plan not found', notFoundPage(), { noindex: true }), 404));
  return app;
}
