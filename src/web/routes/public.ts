import { Hono } from 'hono';
import { displayState } from '../../domain/plan-rules.ts';
import { loadPublicPlan } from '../../domain/plans.ts';
import { isToken } from '../../domain/tokens.ts';
import type { AppConfig, AppDeps } from '../app.ts';
import { layout } from '../views/layout.ts';
import { notFoundPage } from '../views/not-found-page.ts';
import { publicPlanOg, publicPlanPage } from '../views/public-plan-page.ts';

export function publicRoutes(deps: AppDeps, config: AppConfig): Hono {
  const routes = new Hono();
  routes.get('/p/:token', async (c) => {
    const token = c.req.param('token');
    const plan = isToken(token) ? await loadPublicPlan(deps.db, token) : null;
    if (!plan) return c.html(layout('Plan not found', notFoundPage(), { noindex: true }), 404);
    const state = displayState(plan, deps.now());
    const page = publicPlanPage({ plan, state });
    const og = publicPlanOg(plan, state, config.baseUrl);
    const format = plan.format.charAt(0).toUpperCase() + plan.format.slice(1);
    return c.html(layout(`${format} at ${plan.venue}`, page, { noindex: true, og }));
  });
  return routes;
}
