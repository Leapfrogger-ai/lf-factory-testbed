import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { plans } from '../db/schema.ts';
import { suggest, type SuggestInput } from '../suggest/suggest.ts';
import { publishPlan, testDeps } from '../../tests/support/builders.ts';
import { resetDb, testDb } from '../../tests/support/db.ts';
import { fixedClock } from '../../tests/support/fakes.ts';
import { loadFixture } from '../../tests/support/fixtures.ts';
import { commitFormSchema } from '../web/forms.ts';
import { callOff, commit, countPlans, loadFromPlan, loadPlan, loadManagePlan, loadPublicPlan, loadSendTargets, loadWithdrawTarget, recordCheckInAnswer, resolveDeadline, withdraw } from './plans.ts';
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
          gatheringAt: '2026-11-14T18:00:00Z',
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

  it('says why it was called off and who by: creator, deadline, or neither', async () => {
    const deps = testDeps();
    const open = await publishPlan(deps, { name: 'Ana Ruiz', email: 'ana@example.test' });
    expect(await loadPublicPlan(db, open.publicToken)).toMatchObject({ calledOffReason: null, creatorName: 'Ana Ruiz' });

    const byCreator = await publishPlan(deps, { name: 'Ana Ruiz', email: 'ana@example.test' });
    await commit(deps, byCreator.publicToken, commitFormSchema.parse({ name: 'Mia Chen', email: 'mia@example.test' }));
    await callOff(deps, byCreator.manageToken);
    expect(await loadPublicPlan(db, byCreator.publicToken)).toMatchObject({ state: 'called_off', calledOffReason: 'creator', creatorName: 'Ana Ruiz' });
    expect(await loadManagePlan(db, byCreator.manageToken)).toMatchObject({ calledOffReason: 'creator', creatorName: 'Ana Ruiz' });

    const byDeadline = await publishPlan(deps, { name: 'Ana Ruiz', email: 'ana@example.test' });
    await resolveDeadline(db, byDeadline.planId);
    expect(await loadPublicPlan(db, byDeadline.publicToken)).toMatchObject({ state: 'called_off', calledOffReason: 'deadline' });
  });

  it('returns null for an unknown token', async () => {
    await publishPlan(testDeps());

    expect(await loadPublicPlan(db, newToken())).toBeNull();
  });
});

describe('loadManagePlan', () => {
  const form = (name: string, email: string) => commitFormSchema.parse({ name, email });

  it('returns full names of active commits in commit order', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps, { name: 'Ana Ruiz', email: 'ana@example.test' });
    await commit(deps, publicToken, form('Mia Chen', 'mia@example.test'));

    const plan = await loadManagePlan(db, manageToken);

    expect(plan).toMatchObject({
      names: ['Ana Ruiz', 'Mia Chen'],
      minimum: 3,
      publicToken,
      manageToken,
      venue: 'Blue Bottle',
    });
  });

  it('leaves out a withdrawn commit', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps, { name: 'Ana Ruiz', email: 'ana@example.test' });
    await commit(deps, publicToken, form('Mia Chen', 'mia@example.test'));
    const view = await loadPlan(db, manageToken);
    await withdraw(deps, view!.commits.find((c) => !c.isCreator)!.withdrawToken);

    const plan = await loadManagePlan(db, manageToken);

    expect(plan?.names).toEqual(['Ana Ruiz']);
  });

  it('is null for an unknown token', async () => {
    await publishPlan(testDeps());

    expect(await loadManagePlan(db, newToken())).toBeNull();
  });

  it('has no email on the result', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps, { name: 'Ana Ruiz', email: 'ana@example.test' });
    await commit(deps, publicToken, form('Mia Chen', 'mia@example.test'));

    const plan = await loadManagePlan(db, manageToken);

    const json = JSON.stringify(plan);
    expect(json).not.toContain('ana@example.test');
    expect(json).not.toContain('mia@example.test');
  });
});

describe('commit', () => {
  const form = (name: string, email: string) => commitFormSchema.parse({ name, email });

  it('commits a new person and records commit.added with change new', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps);

    const result = await commit(deps, publicToken, form('Mia Chen', 'mia@example.test'));

    expect(result).toMatchObject({ outcome: 'committed', change: 'new', name: 'Mia Chen' });
    const plan = await loadPlan(db, manageToken);
    expect(plan?.count).toBe(2);
    expect(plan?.events.at(-1)).toMatchObject({
      type: 'commit.added',
      data: { change: 'new', isCreator: false, activeCount: 2 },
    });
  });

  it('confirms the plan when the commit reaches the minimum', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps);

    const first = await commit(deps, publicToken, form('Raj Patel', 'raj@example.test'));
    expect(first).toMatchObject({ outcome: 'committed', confirmed: false, planConfirmed: false });
    expect((await loadPlan(db, manageToken))?.state).toBe('open');

    const second = await commit(deps, publicToken, form('Mia Chen', 'mia@example.test'));

    expect(second).toMatchObject({ outcome: 'committed', confirmed: true, planConfirmed: true });
    const plan = await loadPlan(db, manageToken);
    expect(plan?.state).toBe('confirmed');
    expect(plan?.events.slice(-2)).toMatchObject([
      { type: 'commit.added', data: { change: 'new', activeCount: 3 } },
      { type: 'plan.confirmed', data: { activeCount: 3 } },
    ]);
  });

  it('a new commit on a confirmed plan after its commit deadline is stored without a second confirmation', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps);
    await commit(deps, publicToken, form('Raj Patel', 'raj@example.test'));
    await commit(deps, publicToken, form('Mia Chen', 'mia@example.test'));
    const later = testDeps({ now: fixedClock('2026-11-13T18:00:00Z') });

    const result = await commit(later, publicToken, form('Sam Lee', 'sam@example.test'));

    expect(result).toMatchObject({ outcome: 'committed', change: 'new', confirmed: false, planConfirmed: true });
    const plan = await loadPlan(db, manageToken);
    expect(plan?.count).toBe(4);
    expect(plan?.events.filter((e) => e.type === 'plan.confirmed')).toHaveLength(1);
  });

  it('a repeat commit on a confirmed plan confirms nothing and adds no event of type plan.confirmed', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps);
    await commit(deps, publicToken, form('Raj Patel', 'raj@example.test'));
    await commit(deps, publicToken, form('Mia Chen', 'mia@example.test'));

    const result = await commit(deps, publicToken, form('Mia Chen', 'MIA@Example.test'));

    expect(result).toMatchObject({ outcome: 'committed', change: 'repeat', confirmed: false, planConfirmed: true });
    const plan = await loadPlan(db, manageToken);
    expect(plan?.events.filter((e) => e.type === 'plan.confirmed')).toHaveLength(1);
  });

  it('two simultaneous commits on a plan one short of its minimum confirm it once', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps);
    await commit(deps, publicToken, form('Raj Patel', 'raj@example.test'));
    // Open a second pooled connection first, so neither commit waits on a connect and finishes alone.
    await Promise.all([loadPublicPlan(db, publicToken), loadPublicPlan(db, publicToken)]);

    const results = await Promise.all([
      commit(deps, publicToken, form('Mia Chen', 'mia@example.test')),
      commit(deps, publicToken, form('Sam Lee', 'sam@example.test')),
    ]);

    expect(results.filter((r) => r.outcome === 'committed' && r.confirmed)).toHaveLength(1);
    expect(results.every((r) => r.outcome === 'committed' && r.planConfirmed)).toBe(true);
    const plan = await loadPlan(db, manageToken);
    expect(plan?.events.filter((e) => e.type === 'plan.confirmed')).toHaveLength(1);
    expect(plan?.state).toBe('confirmed');
    expect(plan?.count).toBe(4);
  });

  it('a repeat with different case and a new name updates the one commit', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps);
    await commit(deps, publicToken, form('Mia Chen', 'mia@example.test'));

    const result = await commit(deps, publicToken, form('Mimi Chen', ' MIA@Example.test '));

    expect(result).toMatchObject({ outcome: 'committed', change: 'repeat', name: 'Mimi Chen' });
    const plan = await loadPlan(db, manageToken);
    expect(plan?.count).toBe(2);
    expect(plan?.events.at(-1)).toMatchObject({
      type: 'commit.added',
      data: { change: 'repeat', activeCount: 2 },
    });
  });

  it.each([
    ['an open plan after its commit deadline', '2026-11-12T06:00:00Z'],
    ['once the gathering has started', '2026-11-14T18:00:00Z'],
  ])('refuses %s', async (_name, instant) => {
    const { publicToken, manageToken } = await publishPlan(testDeps());
    const later = testDeps({ now: fixedClock(instant) });

    const result = await commit(later, publicToken, form('Mia Chen', 'mia@example.test'));

    expect(result).toEqual({ outcome: 'closed' });
    const plan = await loadPlan(db, manageToken);
    expect(plan?.count).toBe(1);
    expect(plan?.events.map((e) => e.type)).toEqual(['plan.published', 'commit.added']);
  });

  it('returns not_found for an unknown token', async () => {
    const deps = testDeps();
    await publishPlan(deps);

    expect(await commit(deps, newToken(), form('Mia Chen', 'mia@example.test'))).toEqual({ outcome: 'not_found' });
  });

  it('two simultaneous commits with the same new email leave one commit', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps);

    await Promise.all([
      commit(deps, publicToken, form('Mia Chen', 'mia@example.test')),
      commit(deps, publicToken, form('Mia Chen', 'mia@example.test')),
    ]);

    const plan = await loadPlan(db, manageToken);
    expect(plan?.count).toBe(2);
    const changes = plan?.events.flatMap((e) => (e.type === 'commit.added' && e.data.isCreator === false ? [e.data.change] : []));
    expect(changes?.toSorted()).toEqual(['new', 'repeat']);
  });
});

describe('withdraw', () => {
  const form = (name: string, email: string) => commitFormSchema.parse({ name, email });

  // Ana publishes (the creator); the others commit. Returns the non-creator withdraw tokens in commit order.
  async function planWith(deps: ReturnType<typeof testDeps>, minimum: string, others: [string, string][]) {
    const { publicToken, manageToken, planId } = await publishPlan(deps, { minimum, name: 'Ana', email: 'ana@example.test' });
    for (const [name, email] of others) await commit(deps, publicToken, form(name, email));
    const plan = await loadPlan(db, manageToken);
    const tokens = plan!.commits.filter((c) => !c.isCreator).map((c) => c.withdrawToken);
    const creatorToken = plan!.commits.find((c) => c.isCreator)!.withdrawToken;
    return { planId, manageToken, tokens, creatorToken };
  }

  it('withdraw lowers the count and records commit.withdrawn with the new count', async () => {
    const deps = testDeps();
    const { planId, manageToken, tokens } = await planWith(deps, '4', [['Mia Chen', 'mia@example.test']]);

    const result = await withdraw(deps, tokens[0]!);

    expect(result).toEqual({ outcome: 'withdrawn', activeCount: 1, planId });
    const plan = await loadPlan(db, manageToken);
    expect(plan?.count).toBe(1);
    expect(plan?.events.at(-1)).toMatchObject({ type: 'commit.withdrawn', data: { activeCount: 1 } });
    expect(plan?.state).toBe('open');
  });

  it('withdrawing from a confirmed plan at exactly its minimum leaves it confirmed', async () => {
    const deps = testDeps();
    const { planId, manageToken, tokens } = await planWith(deps, '3', [
      ['Raj Patel', 'raj@example.test'],
      ['Mia Chen', 'mia@example.test'],
    ]);
    expect((await loadPlan(db, manageToken))?.state).toBe('confirmed');

    const result = await withdraw(deps, tokens[1]!);

    expect(result).toEqual({ outcome: 'withdrawn', activeCount: 2, planId });
    const plan = await loadPlan(db, manageToken);
    expect(plan?.state).toBe('confirmed');
    expect(plan?.events.filter((e) => e.type === 'plan.confirmed')).toHaveLength(1);
    expect(plan?.events.filter((e) => e.type === 'plan.called_off')).toHaveLength(0);
  });

  it('a second withdraw writes nothing', async () => {
    const deps = testDeps();
    const { manageToken, tokens } = await planWith(deps, '4', [['Mia Chen', 'mia@example.test']]);
    await withdraw(deps, tokens[0]!);
    const before = await loadPlan(db, manageToken);

    const result = await withdraw(deps, tokens[0]!);

    expect(result).toEqual({ outcome: 'already_withdrawn' });
    const after = await loadPlan(db, manageToken);
    expect(after?.events).toHaveLength(before!.events.length);
    expect(after?.count).toBe(1);
  });

  it("the creator's token is not found", async () => {
    const deps = testDeps();
    const { manageToken, creatorToken } = await planWith(deps, '4', [['Mia Chen', 'mia@example.test']]);

    expect(await withdraw(deps, creatorToken)).toEqual({ outcome: 'not_found' });
    expect(await loadWithdrawTarget(db, creatorToken)).toBeNull();
    expect((await loadPlan(db, manageToken))?.count).toBe(2);
  });

  it('an unknown token is not found', async () => {
    const deps = testDeps();
    await planWith(deps, '4', [['Mia Chen', 'mia@example.test']]);

    expect(await withdraw(deps, newToken())).toEqual({ outcome: 'not_found' });
  });

  it('withdraw after the gathering started is unavailable and writes nothing', async () => {
    const deps = testDeps();
    const { manageToken, tokens } = await planWith(deps, '4', [['Mia Chen', 'mia@example.test']]);
    const later = testDeps({ now: fixedClock('2026-11-14T18:00:00Z') });

    const result = await withdraw(later, tokens[0]!);

    expect(result).toEqual({ outcome: 'unavailable' });
    const plan = await loadPlan(db, manageToken);
    expect(plan?.count).toBe(2);
    expect(plan?.events.filter((e) => e.type === 'commit.withdrawn')).toHaveLength(0);
  });

  // Skipped, no test for withdraw on a called-off plan: domain/plans.ts has no call-off function yet, and a
  // called-off plan may not be built any other way. Task 3's view test covers called_off.

  it('two simultaneous withdraws of one token write one event', async () => {
    const deps = testDeps();
    const { manageToken, tokens } = await planWith(deps, '4', [['Mia Chen', 'mia@example.test']]);
    // Open a second pooled connection first, so neither withdraw waits on a connect and finishes alone.
    await Promise.all([loadWithdrawTarget(db, tokens[0]!), loadWithdrawTarget(db, tokens[0]!)]);

    const results = await Promise.all([withdraw(deps, tokens[0]!), withdraw(deps, tokens[0]!)]);

    expect(results.map((r) => r.outcome).toSorted()).toEqual(['already_withdrawn', 'withdrawn']);
    const plan = await loadPlan(db, manageToken);
    expect(plan?.events.filter((e) => e.type === 'commit.withdrawn')).toHaveLength(1);
    expect(plan?.count).toBe(1);
  });
});

describe('loadWithdrawTarget', () => {
  it("returns the plan's format, venue and gathering instant and whether the commit is withdrawn", async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps, { minimum: '4' });
    await commit(deps, publicToken, commitFormSchema.parse({ name: 'Mia Chen', email: 'mia@example.test' }));
    const token = (await loadPlan(db, manageToken))!.commits.find((c) => !c.isCreator)!.withdrawToken;

    const before = await loadWithdrawTarget(db, token);
    await withdraw(deps, token);
    const after = await loadWithdrawTarget(db, token);

    expect(before).toEqual({
      state: 'open',
      format: 'coffee',
      venue: 'Blue Bottle',
      gatheringAt: Temporal.Instant.from('2026-11-14T18:00:00Z'),
      withdrawn: false,
      publicToken,
    });
    expect(after?.withdrawn).toBe(true);
  });
});

describe('commit after withdrawing', () => {
  const form = (name: string, email: string) => commitFormSchema.parse({ name, email });

  // Ana publishes (the creator); the others commit in order. Returns tokens and each other's withdraw token.
  async function planWith(deps: ReturnType<typeof testDeps>, minimum: string, others: [string, string][]) {
    const { publicToken, manageToken } = await publishPlan(deps, { minimum, name: 'Ana', email: 'ana@example.test' });
    for (const [name, email] of others) await commit(deps, publicToken, form(name, email));
    const plan = await loadPlan(db, manageToken);
    const tokens = plan!.commits.filter((c) => !c.isCreator).map((c) => c.withdrawToken);
    return { publicToken, manageToken, tokens };
  }

  it('a withdrawn committer who commits again is active with change rejoined', async () => {
    const deps = testDeps();
    const { publicToken, manageToken, tokens } = await planWith(deps, '3', [
      ['Raj Patel', 'raj@example.test'],
      ['Mia Chen', 'mia@example.test'],
    ]);
    await withdraw(deps, tokens[1]!);

    const result = await commit(deps, publicToken, form('Mia Chen', 'mia@example.test'));

    expect(result).toMatchObject({ outcome: 'committed', change: 'rejoined', confirmed: false, planConfirmed: true });
    const plan = await loadPlan(db, manageToken);
    expect(plan?.count).toBe(3);
    expect(plan?.events.at(-1)).toMatchObject({
      type: 'commit.added',
      data: { change: 'rejoined', isCreator: false, activeCount: 3 },
    });
    expect(plan?.commits.filter((c) => !c.isCreator).map((c) => c.withdrawToken)).toEqual(tokens);
  });

  it('a rejoin with the email in another case is the same commit', async () => {
    const deps = testDeps();
    const { publicToken, manageToken, tokens } = await planWith(deps, '3', [
      ['Raj Patel', 'raj@example.test'],
      ['Mia Chen', 'mia@example.test'],
    ]);
    await withdraw(deps, tokens[1]!);
    const before = await loadPlan(db, manageToken);

    const result = await commit(deps, publicToken, form('Mia Chen', 'MIA@Example.test'));

    expect(result).toMatchObject({ outcome: 'committed', change: 'rejoined' });
    const plan = await loadPlan(db, manageToken);
    expect(before?.count).toBe(2);
    expect(plan?.count).toBe(3);
    expect(plan?.commits).toHaveLength(3);
    expect(before?.commits).toHaveLength(3);
  });

  it('a rejoin that reaches the minimum on an open plan confirms it', async () => {
    const deps = testDeps();
    const { publicToken, manageToken, tokens } = await planWith(deps, '4', [
      ['Raj Patel', 'raj@example.test'],
      ['Mia Chen', 'mia@example.test'],
    ]);
    await withdraw(deps, tokens[1]!);
    await commit(deps, publicToken, form('Sam Lee', 'sam@example.test'));
    expect((await loadPlan(db, manageToken))?.state).toBe('open');

    const result = await commit(deps, publicToken, form('Mia Chen', 'mia@example.test'));

    expect(result).toMatchObject({ outcome: 'committed', change: 'rejoined', confirmed: true, planConfirmed: true });
    const plan = await loadPlan(db, manageToken);
    expect(plan?.state).toBe('confirmed');
    expect(plan?.events.filter((e) => e.type === 'plan.confirmed')).toHaveLength(1);
    expect(plan?.events.slice(-2)).toMatchObject([
      { type: 'commit.added', data: { change: 'rejoined', activeCount: 4 } },
      { type: 'plan.confirmed' },
    ]);
  });

  it('a repeat commit by an active committer is still repeat', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await planWith(deps, '4', [['Mia Chen', 'mia@example.test']]);

    const result = await commit(deps, publicToken, form('Mia Chen', 'mia@example.test'));

    expect(result).toMatchObject({ outcome: 'committed', change: 'repeat' });
    expect((await loadPlan(db, manageToken))?.count).toBe(2);
  });
});

describe('resolveDeadline', () => {
  const form = (name: string, email: string) => commitFormSchema.parse({ name, email });

  // Ann publishes (minimum 3); the others commit.
  async function planWith(deps: ReturnType<typeof testDeps>, others: [string, string][]) {
    const { publicToken, manageToken, planId } = await publishPlan(deps);
    for (const [name, email] of others) await commit(deps, publicToken, form(name, email));
    return { planId, manageToken };
  }

  it('an open plan below its minimum is called off', async () => {
    const deps = testDeps();
    const { planId, manageToken } = await planWith(deps, [['Mia Chen', 'mia@example.test']]);

    const result = await resolveDeadline(db, planId);

    expect(result).toEqual({ state: 'called_off' });
    const plan = await loadPlan(db, manageToken);
    expect(plan?.state).toBe('called_off');
    expect(plan?.events).toContainEqual({
      type: 'plan.called_off',
      data: { reason: 'deadline', wasConfirmed: false, activeCount: 2 },
    });
  });

  it('a plan that reached its minimum stays confirmed (AC4)', async () => {
    const deps = testDeps();
    const { planId, manageToken } = await planWith(deps, [
      ['Mia Chen', 'mia@example.test'],
      ['Raj Patel', 'raj@example.test'],
    ]);

    const result = await resolveDeadline(db, planId);

    expect(result).toEqual({ state: 'confirmed' });
    const plan = await loadPlan(db, manageToken);
    expect(plan?.state).toBe('confirmed');
    expect(plan?.events.map((e) => e.type)).not.toContain('plan.called_off');
  });

  it('counts only active commits', async () => {
    const deps = testDeps();
    const { publicToken, manageToken, planId } = await publishPlan(deps, { minimum: '4' });
    await commit(deps, publicToken, form('Mia Chen', 'mia@example.test'));
    await commit(deps, publicToken, form('Raj Patel', 'raj@example.test'));
    const plan = await loadPlan(db, manageToken);
    await withdraw(deps, plan!.commits.find((c) => !c.isCreator)!.withdrawToken);

    await resolveDeadline(db, planId);

    expect((await loadPlan(db, manageToken))?.events).toContainEqual({
      type: 'plan.called_off',
      data: { reason: 'deadline', wasConfirmed: false, activeCount: 2 },
    });
  });

  it('a creator-only plan is called off with activeCount 1', async () => {
    const deps = testDeps();
    const { planId, manageToken } = await planWith(deps, []);

    await resolveDeadline(db, planId);

    expect((await loadPlan(db, manageToken))?.events).toContainEqual({
      type: 'plan.called_off',
      data: { reason: 'deadline', wasConfirmed: false, activeCount: 1 },
    });
  });

  it('a second call leaves the called-off plan alone', async () => {
    const deps = testDeps();
    const { planId, manageToken } = await planWith(deps, [['Mia Chen', 'mia@example.test']]);
    await resolveDeadline(db, planId);

    const result = await resolveDeadline(db, planId);

    expect(result).toEqual({ state: 'called_off' });
    const plan = await loadPlan(db, manageToken);
    expect(plan?.events.filter((e) => e.type === 'plan.called_off')).toHaveLength(1);
  });
});

describe('loadSendTargets', () => {
  it('returns only non-withdrawn commits, creator first', async () => {
    const deps = testDeps();
    const { publicToken, manageToken, planId } = await publishPlan(deps);
    await commit(deps, publicToken, commitFormSchema.parse({ name: 'Mia Chen', email: 'mia@example.test' }));
    await commit(deps, publicToken, commitFormSchema.parse({ name: 'Raj Patel', email: 'raj@example.test' }));
    const plan = await loadPlan(db, manageToken);
    await withdraw(deps, plan!.commits.filter((c) => !c.isCreator)[0]!.withdrawToken);

    const targets = await loadSendTargets(db, planId);

    expect(targets.plan.id).toBe(planId);
    expect(targets.commits.map((c) => c.name)).toEqual(['Ann', 'Raj Patel']);
  });

  it('throws when there is no plan for the id', async () => {
    await expect(loadSendTargets(db, '00000000-0000-0000-0000-000000000000')).rejects.toThrow('No plan for that id');
  });
});

describe('loadFromPlan', () => {
  const form = (name: string, email: string) => commitFormSchema.parse({ name, email });

  it("returns the old plan's fields and its creator's name and email", async () => {
    const deps = testDeps();
    const { planId, publicToken, manageToken } = await publishPlan(deps, { name: 'Ana Ruiz', email: 'ana@example.test' });
    await commit(deps, publicToken, form('Mia Chen', 'mia@example.test'));

    const from = await loadFromPlan(db, manageToken);

    expect(from).toMatchObject({
      id: planId,
      manageToken,
      city: 'Oakland',
      area: 'Rockridge',
      timeWindow: 'next weekend',
      format: 'coffee',
      venue: 'Blue Bottle',
      minimum: 3,
      name: 'Ana Ruiz',
      email: 'ana@example.test',
    });
  });

  it('is null for undefined, a malformed token and an unknown token', async () => {
    await publishPlan(testDeps());

    expect(await loadFromPlan(db, undefined)).toBeNull();
    expect(await loadFromPlan(db, 'abc')).toBeNull();
    expect(await loadFromPlan(db, newToken())).toBeNull();
  });
});

describe('publish from an old plan', () => {
  const form = (name: string, email: string) => commitFormSchema.parse({ name, email });

  it('with a from plan sets from_plan_id and the event\'s fromPlanId (AC2)', async () => {
    const deps = testDeps();
    const old = await publishPlan(deps, { name: 'Ana Ruiz', email: 'ana@example.test' });
    await commit(deps, old.publicToken, form('Mia Chen', 'mia@example.test'));
    const oldBefore = await loadPlan(db, old.manageToken);
    const from = await loadFromPlan(db, old.manageToken);

    const created = await publishPlan(
      deps,
      { name: from!.name, email: from!.email, date: '2026-11-21', time: '10:00' },
      undefined,
      from!,
    );

    const plan = await loadPlan(db, created.manageToken);
    const [row] = await db.select({ fromPlanId: plans.fromPlanId }).from(plans).where(eq(plans.id, created.planId));
    expect(row?.fromPlanId).toBe(old.planId);
    expect(plan?.events[0]).toEqual({ type: 'plan.published', data: { fromPlanId: old.planId } });
    expect(plan?.publicToken).not.toBe(oldBefore?.publicToken);
    expect(plan?.manageToken).not.toBe(oldBefore?.manageToken);
    expect(plan?.checkInToken).not.toBe(oldBefore?.checkInToken);
    expect(plan?.commits).toHaveLength(1);
    expect(plan?.commits[0]?.isCreator).toBe(true);
    expect(await loadManagePlan(db, created.manageToken)).toMatchObject({ names: ['Ana Ruiz'] });
    expect(await loadPlan(db, old.manageToken)).toEqual(oldBefore);
    expect(oldBefore?.count).toBe(2);
    expect(deps.fakes.planWorkflows.startCalls.map((c) => c.planId)).toEqual([old.planId, created.planId]);
  });

  it('without a from plan leaves from_plan_id null (AC5)', async () => {
    const { planId, manageToken } = await publishPlan(testDeps());

    const plan = await loadPlan(db, manageToken);
    const [row] = await db.select({ fromPlanId: plans.fromPlanId }).from(plans).where(eq(plans.id, planId));
    expect(row?.fromPlanId).toBeNull();
    expect(plan?.events[0]).toEqual({ type: 'plan.published', data: { fromPlanId: null } });
  });
});

describe('callOff', () => {
  const calledOffEvents = async (manageToken: string) =>
    (await loadPlan(db, manageToken))!.events.filter((e) => e.type === 'plan.called_off');

  it('callOff calls an open plan off', async () => {
    const deps = testDeps();
    const { planId, manageToken } = await publishPlan(deps);

    const result = await callOff(deps, manageToken);

    expect(result).toEqual({ outcome: 'called_off', planId });
    const row = await loadPlan(db, manageToken);
    expect(row).toMatchObject({ state: 'called_off', calledOffReason: 'creator' });
    expect(row?.calledOffAt).not.toBeNull();
    expect(await calledOffEvents(manageToken)).toEqual([{ type: 'plan.called_off', data: { reason: 'creator', wasConfirmed: false, activeCount: 1 } }]);
  });

  it('records wasConfirmed true for a confirmed plan', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps, { minimum: '2' });
    await commit(deps, publicToken, commitFormSchema.parse({ name: 'Mia Chen', email: 'mia@example.test' }));

    await callOff(deps, manageToken);

    expect(await calledOffEvents(manageToken)).toEqual([
      { type: 'plan.called_off', data: { reason: 'creator', wasConfirmed: true, activeCount: 2 } },
    ]);
  });

  it('counts only active commits', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps);
    await commit(deps, publicToken, commitFormSchema.parse({ name: 'Mia Chen', email: 'mia@example.test' }));
    const view = await loadPlan(db, manageToken);
    await withdraw(deps, view!.commits.find((c) => !c.isCreator)!.withdrawToken);

    await callOff(deps, manageToken);

    expect(await calledOffEvents(manageToken)).toEqual([
      { type: 'plan.called_off', data: { reason: 'creator', wasConfirmed: false, activeCount: 1 } },
    ]);
  });

  it('writes nothing for a plan already called off', async () => {
    const deps = testDeps();
    const { manageToken } = await publishPlan(deps);
    await callOff(deps, manageToken);

    const result = await callOff(deps, manageToken);

    expect(result).toEqual({ outcome: 'already_called_off' });
    expect(await calledOffEvents(manageToken)).toHaveLength(1);
  });

  it('writes nothing once the gathering started', async () => {
    const deps = testDeps();
    const { manageToken } = await publishPlan(deps);

    const result = await callOff({ ...deps, now: fixedClock('2026-11-14T18:00:00Z') }, manageToken);

    expect(result).toEqual({ outcome: 'too_late' });
    expect((await loadPlan(db, manageToken))?.state).toBe('open');
    expect(await calledOffEvents(manageToken)).toHaveLength(0);
  });

  it('returns not_found for an unknown token', async () => {
    const deps = testDeps();

    expect(await callOff(deps, newToken())).toEqual({ outcome: 'not_found' });
  });
});

describe('recordCheckInAnswer', () => {
  const form = (name: string, email: string) => commitFormSchema.parse({ name, email });

  // Ann plus Mia and Raj make 3 of 3, which confirms the plan.
  async function confirmedPlan(deps: ReturnType<typeof testDeps>) {
    const published = await publishPlan(deps, { name: 'Ann', email: 'ann@example.test' });
    await commit(deps, published.publicToken, form('Mia Chen', 'mia@example.test'));
    await commit(deps, published.publicToken, form('Raj Patel', 'raj@example.test'));
    return published;
  }

  const answeredEvents = async (manageToken: string) =>
    ((await loadPlan(db, manageToken))?.events ?? []).filter((e) => e.type === 'check_in.answered');

  it('records an answer and an event, and reports the other question unanswered', async () => {
    const deps = testDeps();
    const { manageToken } = await confirmedPlan(deps);
    const plan = await loadPlan(db, manageToken);

    const result = await recordCheckInAnswer(deps, plan!.checkInToken, 'happened', true);

    expect(result).toMatchObject({ outcome: 'recorded', other: 'attended', otherAnswered: false });
    expect((await loadPlan(db, manageToken))?.checkInAnswers).toEqual([{ question: 'happened', answer: true }]);
    expect(await answeredEvents(manageToken)).toEqual([
      { type: 'check_in.answered', data: { question: 'happened', answer: true } },
    ]);
  });

  it('returns the plan format, venue and gathering instant with a recorded answer', async () => {
    const deps = testDeps();
    const { manageToken } = await confirmedPlan(deps);
    const plan = await loadPlan(db, manageToken);

    const result = await recordCheckInAnswer(deps, plan!.checkInToken, 'happened', true);

    expect(result.outcome).toBe('recorded');
    if (result.outcome !== 'recorded') return;
    expect({ ...result.plan, gatheringAt: result.plan.gatheringAt.toString() }).toEqual({
      format: 'coffee',
      venue: 'Blue Bottle',
      gatheringAt: Temporal.Instant.from('2026-11-14T18:00:00Z').toString(),
    });
  });

  it('replaces a repeated answer and records a second event', async () => {
    const deps = testDeps();
    const { manageToken } = await confirmedPlan(deps);
    const { checkInToken } = (await loadPlan(db, manageToken))!;

    await recordCheckInAnswer(deps, checkInToken, 'happened', true);
    await recordCheckInAnswer(deps, checkInToken, 'happened', false);

    expect((await loadPlan(db, manageToken))?.checkInAnswers).toEqual([{ question: 'happened', answer: false }]);
    expect((await answeredEvents(manageToken)).map((e) => e.data.answer)).toEqual([true, false]);
  });

  it('reports the other question answered once both exist', async () => {
    const deps = testDeps();
    const { manageToken } = await confirmedPlan(deps);
    const { checkInToken } = (await loadPlan(db, manageToken))!;

    await recordCheckInAnswer(deps, checkInToken, 'happened', true);
    const result = await recordCheckInAnswer(deps, checkInToken, 'attended', false);

    expect(result).toMatchObject({ outcome: 'recorded', other: 'happened', otherAnswered: true });
    expect((await loadPlan(db, manageToken))?.checkInAnswers).toEqual([
      { question: 'attended', answer: false },
      { question: 'happened', answer: true },
    ]);
  });

  it.each([
    [
      'a called-off plan',
      async (deps: ReturnType<typeof testDeps>) => {
        const published = await confirmedPlan(deps);
        await callOff(deps, published.manageToken);
        return { manageToken: published.manageToken, token: (await loadPlan(db, published.manageToken))!.checkInToken };
      },
    ],
    [
      'an open plan',
      async (deps: ReturnType<typeof testDeps>) => {
        const published = await publishPlan(deps);
        return { manageToken: published.manageToken, token: (await loadPlan(db, published.manageToken))!.checkInToken };
      },
    ],
    [
      'an unknown token',
      async (deps: ReturnType<typeof testDeps>) => {
        const published = await confirmedPlan(deps);
        return { manageToken: published.manageToken, token: newToken() };
      },
    ],
  ])('records nothing for %s', async (_name, setup) => {
    const deps = testDeps();
    const { manageToken, token } = await setup(deps);

    const result = await recordCheckInAnswer(deps, token, 'happened', true);

    expect(result).toEqual({ outcome: 'not_found' });
    expect((await loadPlan(db, manageToken))?.checkInAnswers).toEqual([]);
    expect(await answeredEvents(manageToken)).toEqual([]);
  });
});
