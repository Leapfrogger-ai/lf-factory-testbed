import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.ts';
import { commit, resolveDeadline } from '../src/domain/plans.ts';
import { loadSuggestion, recordSuggestion } from '../src/domain/suggestions.ts';
import { suggest, type SuggestInput } from '../src/suggest/suggest.ts';
import { publishPlan, testDeps } from './support/builders.ts';
import { resetDb, testDb } from './support/db.ts';
import { loadFixture } from './support/fixtures.ts';
import { commitFormSchema } from '../src/web/forms.ts';
import { trialQueries, trialQuery } from './support/trial-metrics.ts';

const { db, pool } = testDb();

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const suggestionInput: SuggestInput = { city: 'Oakland', area: 'Rockridge', timeWindow: 'next weekend, morning' };

const fromSuggestion = {
  format: 'coffee',
  venue: 'Highwire Coffee Roasters',
  date: '2026-11-14',
  time: '10:00',
  minimum: '3',
  deadlineDate: '2026-11-11',
  deadlineTime: '22:00',
};

async function runQuery(database: Db, marker: string): Promise<Record<string, unknown>[]> {
  const result = await database.execute(sql.raw(trialQuery(marker)));
  return result.rows;
}

// (a) a failed suggestion, (b) an ok one that follows it, (c) a plan published from (b),
// (d) a plan with no suggestion, called off at its deadline.
async function seed(deps: ReturnType<typeof testDeps>) {
  const failedId = await recordSuggestion(deps, suggestionInput, { outcome: 'failed', failureReason: 'timeout', latencyMs: 20000 });
  const result = await suggest(suggestionInput, { suggestPlanCall: async () => loadFixture('good'), now: deps.now });
  const okId = await recordSuggestion(deps, suggestionInput, result, failedId);
  const suggestion = await loadSuggestion(db, okId);
  if (suggestion?.outcome !== 'ok') throw new Error('expected an ok suggestion');
  await publishPlan(deps, fromSuggestion, suggestion);
  const second = await publishPlan(deps);
  await resolveDeadline(db, second.planId);
}

describe('trial metric queries', () => {
  it('runs every query in the Trial metric queries section without error', async () => {
    await seed(testDeps());

    expect(trialQueries()).toHaveLength(7);
    for (const statement of trialQueries()) {
      await expect(db.execute(sql.raw(statement))).resolves.toBeDefined();
    }

    const link = await runQuery(db, 'create_to_link');
    expect(link).toHaveLength(1);
    expect(link[0]?.suggestions_seen).toBe('2');
    expect(await runQuery(db, 'lateness')).toHaveLength(1);
  });

  it('share rate is 0.5 for one shared plan and one creator-only plan (AC1)', async () => {
    const deps = testDeps();
    const shared = await publishPlan(deps, { name: 'Ann' });
    await commit(deps, shared.publicToken, commitFormSchema.parse({ name: 'Mia', email: 'mia@example.test' }));
    await publishPlan(deps, { name: 'Bea', email: 'bea@example.test' });

    const rows = await runQuery(db, 'share_rate');

    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.share_rate)).toBe(0.5);
  });

  it('share rate is null with no plans', async () => {
    const rows = await runQuery(db, 'share_rate');

    expect(rows[0]?.share_rate).toBeNull();
  });

  it('edited rate is 0.5 for one unchanged and one edited published suggestion (AC3)', async () => {
    const deps = testDeps();
    for (const overrides of [fromSuggestion, { ...fromSuggestion, venue: 'Another Cafe' }]) {
      const result = await suggest(suggestionInput, { suggestPlanCall: async () => loadFixture('good'), now: deps.now });
      const id = await recordSuggestion(deps, suggestionInput, result);
      const suggestion = await loadSuggestion(db, id);
      if (suggestion?.outcome !== 'ok') throw new Error('expected an ok suggestion');
      await publishPlan(deps, overrides, suggestion);
    }

    const rows = await runQuery(db, 'edited_rate');

    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.edited_rate)).toBe(0.5);
  });
});
