import { Hono } from 'hono';
import { loadPlan } from '../../domain/plans.ts';
import { isToken } from '../../domain/tokens.ts';
import type { AppConfig, AppDeps } from '../app.ts';
import { layout } from '../views/layout.ts';
import { notFoundPage } from '../views/not-found-page.ts';
import { publishedPage } from '../views/published-page.ts';

export function manageRoutes(deps: AppDeps, config: AppConfig): Hono {
  const routes = new Hono();
  routes.get('/m/:token/published', async (c) => {
    const token = c.req.param('token');
    const plan = isToken(token) ? await loadPlan(deps.db, token) : null;
    if (!plan) return c.html(layout('Plan not found', notFoundPage()), 404);
    const page = publishedPage({
      publicLink: `${config.baseUrl}/p/${plan.publicToken}`,
      manageLink: `/m/${plan.manageToken}`,
    });
    return c.html(layout('Your plan is ready to share', page, { noindex: true }));
  });
  return routes;
}
