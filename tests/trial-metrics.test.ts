import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.ts';
import { resolveDeadline } from '../src/domain/plans.ts';
import { loadSuggestion, recordSuggestion } from '../src/domain/suggestions.ts';
import { suggest, type SuggestInput } from '../src/suggest/suggest.ts';
import { publishPlan, testDeps } from './support/builders.ts';
import { resetDb, testDb } from './support/db.ts';
import { loadFixture } from './support/fixtures.ts';
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
});
