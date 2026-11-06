import { Hono, type Context } from 'hono';
import { displayState } from '../../domain/plan-rules.ts';
import { callOff, loadManagePlan, loadPlan, loadPublicPlan } from '../../domain/plans.ts';
import { formatShareWhen } from '../../domain/time.ts';
import { isToken } from '../../domain/tokens.ts';
import { log } from '../../log.ts';
import type { AppConfig, AppDeps } from '../app.ts';
import { layout } from '../views/layout.ts';
import { managePage } from '../views/manage-page.ts';
import { notFoundPage } from '../views/not-found-page.ts';
import { capitalise } from '../views/public-plan-page.ts';
import { publishedPage } from '../views/published-page.ts';

function notFound(c: Context) {
  return c.html(layout('Plan not found', notFoundPage(), { noindex: true }), 404);
}

export function manageRoutes(deps: AppDeps, config: AppConfig): Hono {
  const routes = new Hono();
  routes.get('/m/:token', async (c) => {
    const token = c.req.param('token');
    const plan = isToken(token) ? await loadManagePlan(deps.db, token) : null;
    if (!plan) return notFound(c);
    const now = deps.now();
    const page = managePage({
      plan,
      state: displayState(plan, now),
      publicLink: `${config.baseUrl}/p/${plan.publicToken}`,
      now,
      notice: c.req.query('notice') === 'too-late' ? 'too-late' : undefined,
    });
    const nonce = c.get('secureHeadersNonce') as string;
    return c.html(layout(`Your plan: ${plan.venue}`, page, { noindex: true, script: { src: '/static/create.js', nonce } }));
  });
  routes.post('/m/:token/call-off', async (c) => {
    const token = c.req.param('token');
    if (!isToken(token)) return notFound(c);
    const result = await callOff(deps, token);
    if (result.outcome === 'not_found') return notFound(c);
    if (result.outcome === 'too_late') return c.redirect(`/m/${token}?notice=too-late`, 303);
    if (result.outcome === 'called_off') {
      try {
        await deps.planWorkflows.signal(result.planId, 'calledOff');
      } catch (error) {
        log.error('plan signal failed', {
          planId: result.planId,
          signal: 'calledOff',
          errorName: error instanceof Error ? error.name : 'unknown',
        });
      }
    }
    return c.redirect(`/m/${token}`, 303);
  });
  routes.get('/m/:token/published', async (c) => {
    const token = c.req.param('token');
    const plan = isToken(token) ? await loadPlan(deps.db, token) : null;
    const shown = plan ? await loadPublicPlan(deps.db, plan.publicToken) : null;
    if (!plan || !shown) return notFound(c);
    const page = publishedPage({
      publicLink: `${config.baseUrl}/p/${plan.publicToken}`,
      manageLink: `/m/${plan.manageToken}`,
      emailed: plan.manageLinkSent,
      shareText: `${capitalise(shown.format)} at ${shown.venue}, ${formatShareWhen(shown.gatheringAt)} — I'm in, who else?`,
    });
    const nonce = c.get('secureHeadersNonce') as string;
    return c.html(layout('Your plan is ready to share', page, { noindex: true, script: { src: '/static/create.js', nonce } }));
  });
  return routes;
}
