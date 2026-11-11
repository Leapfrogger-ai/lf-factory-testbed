import { describe, expect, it } from 'vitest';
import type { PublicPlan } from '../../domain/plans.ts';
import type { WithdrawTarget } from '../../domain/plans.ts';
import { createPage } from './create-page.ts';
import { notFoundPage } from './not-found-page.ts';
import { publicPlanPage } from './public-plan-page.ts';
import { publishedPage } from './published-page.ts';
import { systemErrorPage } from './system-error-page.ts';
import { withdrawPage } from './withdraw-page.ts';

const plan: PublicPlan = {
  state: 'open',
  format: 'coffee',
  venue: 'Blue Bottle',
  city: 'Oakland',
  gatheringAt: Temporal.Instant.from('2026-11-14T18:00:00Z'),
  commitDeadlineAt: Temporal.Instant.from('2026-11-12T06:00:00Z'),
  minimum: 3,
  names: ['Ana Ruiz'],
};

const target = (overrides: Partial<WithdrawTarget> = {}): WithdrawTarget => ({
  state: 'open',
  format: 'coffee',
  venue: 'Blue Bottle',
  gatheringAt: plan.gatheringAt,
  withdrawn: false,
  publicToken: 'ptok123',
  ...overrides,
});
const before = Temporal.Instant.from('2026-11-10T12:00:00Z');
const withdraw = (t: WithdrawTarget, now = before) => String(withdrawPage({ target: t, token: 't', now }));

const pages: Record<string, string> = {
  create: String(createPage({ kind: 'inputs', values: {} }, {})),
  published: String(
    publishedPage({
      publicLink: 'https://x/p/1',
      manageLink: '/m/1',
      manageUrl: 'https://x/m/1',
      emailed: true,
      shareText: 'x',
    }),
  ),
  public: String(publicPlanPage({ plan, state: 'needs_more', publicToken: 'tok', now: Temporal.Instant.from('2026-11-10T18:00:00Z') })),
  'withdraw called off': withdraw(target({ state: 'called_off' })),
  'withdraw already started': withdraw(target(), Temporal.Instant.from('2026-11-14T19:00:00Z')),
  'withdraw withdrawn': withdraw(target({ withdrawn: true })),
  'withdraw question': withdraw(target()),
  'not found': String(notFoundPage()),
  'system error': String(systemErrorPage()),
};

describe('the wordmark', () => {
  for (const [name, html] of Object.entries(pages)) {
    it(`leads the ${name} page, before its only h1`, () => {
      const brand = html.indexOf('<p class="brand">calvin</p>');
      expect(brand).toBeGreaterThanOrEqual(0);
      expect(brand).toBeLessThan(html.indexOf('<h1'));
      expect(html.match(/<h1/g)).toHaveLength(1);
    });
  }
});
