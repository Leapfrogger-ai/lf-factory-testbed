import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { suggest, type SuggestInput } from '../suggest/suggest.ts';
import { testDeps } from '../../tests/support/builders.ts';
import { resetDb, testDb } from '../../tests/support/db.ts';
import { loadFixture, type FixtureName } from '../../tests/support/fixtures.ts';
import { loadSuggestion, recordSuggestion } from './suggestions.ts';

const { db, pool } = testDb();

const input: SuggestInput = { city: 'Oakland', area: 'Rockridge', timeWindow: 'next weekend, morning' };

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

async function suggestFrom(deps: ReturnType<typeof testDeps>, fixture: FixtureName) {
  const response = loadFixture(fixture);
  return suggest(input, { suggestPlanCall: async () => response, now: deps.now });
}

describe('recordSuggestion and loadSuggestion', () => {
  it('stores an ok suggestion with the default commit deadline', async () => {
    const deps = testDeps();
    const id = await recordSuggestion(deps, input, await suggestFrom(deps, 'good'));

    const suggestion = await loadSuggestion(db, id);

    expect(suggestion).toMatchObject({ id, outcome: 'ok', ...input, format: 'coffee', venue: 'Highwire Coffee Roasters', minimum: 3 });
    expect(suggestion?.outcome === 'ok' && suggestion.gatheringAt.toString()).toBe('2026-11-14T18:00:00Z');
    expect(suggestion?.outcome === 'ok' && suggestion.commitDeadlineAt.toString()).toBe('2026-11-12T06:00:00Z');
  });

  it('stores a failed suggestion with its reason (AC3)', async () => {
    const deps = testDeps();
    const id = await recordSuggestion(deps, input, await suggestFrom(deps, 'refusal'));

    const suggestion = await loadSuggestion(db, id);

    expect(suggestion).toMatchObject({ id, outcome: 'failed', failureReason: 'refusal', ...input });
  });

  it('returns null for text that is not a UUID, and for an unknown UUID (AC7)', async () => {
    expect(await loadSuggestion(db, 'not-a-uuid')).toBeNull();
    expect(await loadSuggestion(db, '')).toBeNull();
    expect(await loadSuggestion(db, '3f2b8c1e-9d4a-4e6b-8a7c-5d1e2f3a4b5c')).toBeNull();
  });
});
