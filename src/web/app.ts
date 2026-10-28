import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import type { Db } from '../db/client.ts';
import type { Schedule } from '../domain/plan-rules.ts';
import { log } from '../log.ts';
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
  suggestPlanCall: (request: unknown) => Promise<unknown>;
  sendEmail: (payload: unknown, idempotencyKey: string) => Promise<{ id: string }>;
  planWorkflows: {
    start(planId: string, schedule: Schedule): Promise<void>;
    signal(planId: string, signal: string, arg?: unknown): Promise<void>;
  };
};

export type AppConfig = { baseUrl: string };

export function createApp(deps: AppDeps, config: AppConfig): Hono {
  const app = new Hono();
  app.use('*', requestLogger());
  app.get('/healthz', (c) => c.text('ok'));
  app.use('/static/*', async (c, next) => {
    await next();
    if (c.res.status === 200) c.res.headers.set('Cache-Control', 'public, max-age=86400');
  });
  app.use('/static/*', serveStatic({ root: './public', rewriteRequestPath: (path) => path.replace(/^\/static/, '') }));
  app.route('/', createRoutes(deps));
  app.route('/', manageRoutes(deps, config));
  app.onError((err, c) => {
    log.error('unexpected error', { errorName: err.name });
    return c.html(layout('Something went wrong', systemErrorPage()), 500);
  });
  app.notFound((c) => c.html(layout('Plan not found', notFoundPage()), 404));
  return app;
}
