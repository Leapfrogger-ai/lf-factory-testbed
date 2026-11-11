import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { displayState } from '../../domain/plan-rules.ts';
import { commit, loadPublicPlan, type PublicPlan } from '../../domain/plans.ts';
import { isToken } from '../../domain/tokens.ts';
import { log } from '../../log.ts';
import type { AppConfig, AppDeps } from '../app.ts';
import { schemaErrors } from '../field-errors.ts';
import { commitFormSchema } from '../forms.ts';
import { layout } from '../views/layout.ts';
import { notFoundPage } from '../views/not-found-page.ts';
import { firstName, publicPlanOg, publicPlanPage, type CommitFormState } from '../views/public-plan-page.ts';

export function publicRoutes(deps: AppDeps, config: AppConfig): Hono {
  const routes = new Hono();

  function renderPlan(c: Context, plan: PublicPlan, token: string, form?: CommitFormState, status?: 422) {
    const now = deps.now();
    const state = displayState(plan, now);
    const code = c.req.query('notice');
    const n = c.req.query('n');
    const notice = code === undefined ? undefined : { code, ...(n === undefined ? {} : { n }) };
    const page = publicPlanPage({ plan, state, publicToken: token, now, ...(notice ? { notice } : {}), ...(form ? { form } : {}) });
    const og = publicPlanOg(plan, state, config.baseUrl);
    const format = plan.format.charAt(0).toUpperCase() + plan.format.slice(1);
    const html = layout(`${format} at ${plan.venue}`, page, { noindex: true, og });
    return status === undefined ? c.html(html) : c.html(html, status);
  }

  const notFound = (c: Context) => c.html(layout('Plan not found', notFoundPage(), { noindex: true }), 404);

  routes.get('/p/:token', async (c) => {
    const token = c.req.param('token');
    const plan = isToken(token) ? await loadPublicPlan(deps.db, token) : null;
    if (!plan) return notFound(c);
    return renderPlan(c, plan, token);
  });

  routes.post(
    '/p/:token/commit',
    async (c, next) => (isToken(c.req.param('token')) ? next() : notFound(c)),
    zValidator('form', commitFormSchema, async (result, c) => {
      if (result.success) return undefined;
      const token = c.req.param('token') ?? '';
      const plan = await loadPublicPlan(deps.db, token);
      if (!plan) return notFound(c);
      const raw = await c.req.parseBody();
      const values = {
        name: typeof raw.name === 'string' ? raw.name : '',
        email: typeof raw.email === 'string' ? raw.email : '',
      };
      return renderPlan(c, plan, token, { values, errors: schemaErrors(result.error.issues) }, 422);
    }),
    async (c) => {
      const token = c.req.param('token') ?? '';
      const result = await commit(deps, token, c.req.valid('form'));
      if (result.outcome === 'not_found') return notFound(c);
      if (result.outcome === 'closed') return c.redirect(`/p/${token}?notice=closed`, 303);
      const signal = result.confirmed
        ? { name: 'confirmed', arg: undefined }
        : result.planConfirmed && result.change !== 'repeat'
          ? { name: 'committed', arg: result.commitId }
          : undefined;
      if (signal) {
        try {
          await deps.planWorkflows.signal(result.planId, signal.name, signal.arg);
        } catch (error) {
          log.error('plan signal failed', {
            planId: result.planId,
            signal: signal.name,
            errorName: error instanceof Error ? error.name : 'unknown',
          });
        }
      }
      const notice = result.change === 'repeat' ? 'updated' : result.planConfirmed ? 'on' : 'in';
      return c.redirect(`/p/${token}?notice=${notice}&n=${encodeURIComponent(firstName(result.name))}`, 303);
    },
  );
  return routes;
}
