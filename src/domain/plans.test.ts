import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { suggest, type SuggestInput } from '../suggest/suggest.ts';
import { publishPlan, testDeps } from '../../tests/support/builders.ts';
import { resetDb, testDb } from '../../tests/support/db.ts';
import { loadFixture } from '../../tests/support/fixtures.ts';
import { countPlans, loadPlan, loadPublicPlan } from './plans.ts';
import { loadSuggestion, recordSuggestion } from './suggestions.ts';
import { newToken } from './tokens.ts';

const { db, pool } = testDb();

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const suggestionInput: SuggestInput = { city: 'Oakland', area: 'Rockridge', timeWindow: 'next weekend, morning' };

// The good proposal at clock 2026-11-09T18:00Z: coffee at Highwire, 2026-11-14 10:00 local, minimum 3,
// default deadline 2026-11-12T06:00Z (2026-11-11 22:00 local).
async function okSuggestion(deps: ReturnType<typeof testDeps>) {
  const response = loadFixture('good');
  const result = await suggest(suggestionInput, { suggestPlanCall: async () => response, now: deps.now });
  const id = await recordSuggestion(deps, suggestionInput, result);
  const suggestion = await loadSuggestion(db, id);
  if (suggestion?.outcome !== 'ok') throw new Error('expected an ok suggestion');
  return suggestion;
}

const fromSuggestion = {
  format: 'coffee',
  venue: 'Highwire Coffee Roasters',
  date: '2026-11-14',
  time: '10:00',
  minimum: '3',
  deadlineDate: '2026-11-11',
  deadlineTime: '22:00',
};

describe('publish from a suggestion', () => {
  it('published without changes links the suggestion and is not edited (AC8)', async () => {
    const deps = testDeps();
    const suggestion = await okSuggestion(deps);

    const { manageToken } = await publishPlan(deps, fromSuggestion, suggestion);

    const plan = await loadPlan(db, manageToken);
    expect(plan?.suggestionId).toBe(suggestion.id);
    expect(plan?.suggestionEdited).toBe(false);
  });

  it.each([
    ['venue', { venue: 'Blue Bottle' }],
    ['format', { format: 'drinks' }],
    ['minimum', { minimum: '4' }],
    ['deadline', { deadlineDate: '2026-11-11', deadlineTime: '20:00' }],
  ])('a changed %s is edited (AC9)', async (_field, change) => {
    const deps = testDeps();
    const suggestion = await okSuggestion(deps);

    const { manageToken } = await publishPlan(deps, { ...fromSuggestion, ...change }, suggestion);

    expect((await loadPlan(db, manageToken))?.suggestionEdited).toBe(true);
  });

  it('a venue that differs only by trailing spaces is not edited', async () => {
    const deps = testDeps();
    const suggestion = await okSuggestion(deps);

    const { manageToken } = await publishPlan(deps, { ...fromSuggestion, venue: 'Highwire Coffee Roasters  ' }, suggestion);

    expect((await loadPlan(db, manageToken))?.suggestionEdited).toBe(false);
  });

  it('When changed with Decide by left at the suggestion\'s takes the default for the new When (AC10)', async () => {
    const deps = testDeps();
    const suggestion = await okSuggestion(deps);

    const { manageToken } = await publishPlan(deps, { ...fromSuggestion, date: '2026-11-20' }, suggestion);

    const plan = await loadPlan(db, manageToken);
    expect(plan?.commitDeadlineAt).toBe('2026-11-15T06:00:00Z');
    expect(plan?.suggestionEdited).toBe(true);
  });

  it('a plan published without a suggestion has none (AC11)', async () => {
    const { manageToken } = await publishPlan(testDeps());

    const plan = await loadPlan(db, manageToken);
    expect(plan?.suggestionId).toBeNull();
    expect(plan?.suggestionEdited).toBeNull();
  });
});

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

describe('loadPublicPlan', () => {
  it('returns the plan facts and active committers without any email', async () => {
    const { publicToken } = await publishPlan(testDeps(), { name: 'Ana Ruiz', email: 'ana@example.test' });

    const plan = await loadPublicPlan(db, publicToken);

    expect(plan).toMatchObject({
      state: 'open',
      format: 'coffee',
      venue: 'Blue Bottle',
      city: 'Oakland',
      minimum: 3,
      names: ['Ana Ruiz'],
    });
    expect(plan?.gatheringAt.toString()).toBe('2026-11-14T18:00:00Z');
    expect(plan?.commitDeadlineAt.toString()).toBe('2026-11-12T06:00:00Z');
    expect(JSON.stringify(plan)).not.toContain('example.test');
  });

  it('returns null for an unknown token', async () => {
    await publishPlan(testDeps());

    expect(await loadPublicPlan(db, newToken())).toBeNull();
  });
});
