import { publish } from '../../src/domain/plans.ts';
import { publishFormSchema } from '../../src/web/forms.ts';
import type { AppDeps } from '../../src/web/app.ts';
import { testDb } from './db.ts';
import { fakeEmail, fakePlanWorkflows, fakeSuggest, fixedClock } from './fakes.ts';

export const TEST_BASE_URL = 'https://calvin.test';

export function planForm(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    city: 'Oakland',
    area: 'Rockridge',
    timeWindow: 'next weekend',
    format: 'coffee',
    venue: 'Blue Bottle',
    date: '2026-11-14',
    time: '10:00',
    minimum: '3',
    deadlineDate: '',
    deadlineTime: '',
    name: 'Ann',
    email: 'ann@example.test',
    ...overrides,
  };
}

export function testDeps(overrides: Partial<AppDeps> = {}) {
  const { db } = testDb();
  const fakes = {
    email: fakeEmail(),
    planWorkflows: fakePlanWorkflows(),
    suggest: fakeSuggest(),
  };
  const deps: AppDeps = {
    db,
    now: fixedClock('2026-11-09T18:00:00Z'),
    suggestPlanCall: fakes.suggest.call,
    sendEmail: fakes.email.send,
    planWorkflows: fakes.planWorkflows,
    ...overrides,
  };
  return { ...deps, fakes };
}

export async function publishPlan(deps: ReturnType<typeof testDeps>, overrides: Record<string, string> = {}) {
  const form = publishFormSchema.parse(planForm(overrides));
  return publish(deps, form);
}
