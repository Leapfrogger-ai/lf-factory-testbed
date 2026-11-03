import { Hono, type Context } from 'hono';
import { loadWithdrawTarget, withdraw } from '../../domain/plans.ts';
import { isToken } from '../../domain/tokens.ts';
import type { AppDeps } from '../app.ts';
import { layout } from '../views/layout.ts';
import { notFoundPage } from '../views/not-found-page.ts';
import { withdrawPage } from '../views/withdraw-page.ts';

export function withdrawRoutes(deps: AppDeps): Hono {
  const routes = new Hono();

  const notFound = (c: Context) => c.html(layout('Plan not found', notFoundPage(), { noindex: true }), 404);

  routes.get('/w/:token', async (c) => {
    const token = c.req.param('token');
    const target = isToken(token) ? await loadWithdrawTarget(deps.db, token) : null;
    if (!target) return notFound(c);
    return c.html(layout('Withdraw', withdrawPage({ target, token, now: deps.now() }), { noindex: true }));
  });

  routes.post('/w/:token', async (c) => {
    const token = c.req.param('token');
    if (!isToken(token)) return notFound(c);
    const result = await withdraw(deps, token);
    if (result.outcome === 'not_found') return notFound(c);
    if (result.outcome === 'unavailable') return c.redirect(`/w/${token}`, 303);
    return c.redirect(`/w/${token}?done=1`, 303);
  });

  return routes;
}
