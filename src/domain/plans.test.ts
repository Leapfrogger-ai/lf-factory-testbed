import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { publishPlan, testDeps } from '../../tests/support/builders.ts';
import { resetDb, testDb } from '../../tests/support/db.ts';
import { countPlans, loadPlan } from './plans.ts';

const { db, pool } = testDb();

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

describe('publish', () => {
  it('a published plan is open with its creator as only committer', async () => {
    const deps = testDeps();
    const { manageToken } = await publishPlan(deps);

    const plan = await loadPlan(db, manageToken);

    expect(plan?.state).toBe('open');
    expect(plan?.count).toBe(1);
    expect(plan?.commits).toHaveLength(1);
    expect(plan?.commits[0]?.isCreator).toBe(true);
    expect(plan?.events.map((e) => e.type)).toEqual(['plan.published', 'commit.added']);
    expect(plan?.events[1]?.data).toEqual({ change: 'new', isCreator: true, activeCount: 1 });
  });

  it('tokens are 43 base64url characters and differ', async () => {
    const { manageToken } = await publishPlan(testDeps());
    const plan = await loadPlan(db, manageToken);

    const tokens = [plan!.publicToken, plan!.manageToken, plan!.checkInToken, plan!.commits[0]!.withdrawToken];

    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(tokens).size).toBe(4);
  });

  it('starts the workflow once with the schedule', async () => {
    const deps = testDeps();
    const { planId, manageToken } = await publishPlan(deps);

    expect(deps.fakes.planWorkflows.startCalls).toEqual([
      {
        planId,
        schedule: {
          deadlineAt: '2026-11-12T06:00:00Z',
          reminder24At: '2026-11-13T18:00:00Z',
          reminderMorningAt: '2026-11-14T16:00:00Z',
          checkInAt: '2026-11-15T18:00:00Z',
        },
      },
    ]);
    const plan = await loadPlan(db, manageToken);
    expect(plan?.gatheringAt).toBe('2026-11-14T18:00:00Z');
    expect(plan?.commitDeadlineAt).toBe('2026-11-12T06:00:00Z');
  });

  it('a failed workflow start stores nothing', async () => {
    const deps = testDeps();
    deps.fakes.planWorkflows.failStart(new Error('temporal down'));

    await expect(publishPlan(deps)).rejects.toThrow('temporal down');

    expect(await countPlans(db)).toBe(0);
  });
});
