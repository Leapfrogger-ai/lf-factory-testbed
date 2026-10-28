import { Hono } from 'hono';
import type { Db } from '../db/client.ts';
import type { Schedule } from '../domain/plan-rules.ts';
import { layout } from './views/layout.ts';
import { notFoundPage } from './views/not-found-page.ts';

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

export function createApp(_deps: AppDeps): Hono {
  const app = new Hono();
  app.get('/healthz', (c) => c.text('ok'));
  app.notFound((c) => c.html(layout('Plan not found', notFoundPage()), 404));
  return app;
}
