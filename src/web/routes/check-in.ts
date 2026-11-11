import { Hono, type Context } from 'hono';
import { recordCheckInAnswer, type CheckInQuestion } from '../../domain/plans.ts';
import { isToken } from '../../domain/tokens.ts';
import type { AppDeps } from '../app.ts';
import { checkInPage } from '../views/check-in-page.ts';
import { layout } from '../views/layout.ts';
import { notFoundPage } from '../views/not-found-page.ts';

const isQuestion = (value: string): value is CheckInQuestion => value === 'happened' || value === 'attended';

export function checkInRoutes(deps: AppDeps): Hono {
  const routes = new Hono();

  const notFound = (c: Context) => c.html(layout('Plan not found', notFoundPage(), { noindex: true }), 404);

  routes.get('/c/:token/:question/:answer', async (c) => {
    const { token, question, answer } = c.req.param();
    if (!isToken(token) || !isQuestion(question) || (answer !== 'yes' && answer !== 'no')) return notFound(c);
    const result = await recordCheckInAnswer(deps, token, question, answer === 'yes');
    if (result.outcome === 'not_found') return notFound(c);
    const next = result.otherAnswered ? null : result.other;
    const page = checkInPage({ token, question, answer: answer === 'yes', next, plan: result.plan });
    return c.html(layout('Thanks', page, { noindex: true }));
  });

  return routes;
}
