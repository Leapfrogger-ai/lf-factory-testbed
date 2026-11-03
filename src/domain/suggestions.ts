import { count, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { suggestions } from '../db/schema.ts';
import type { FailureReason, SuggestInput, SuggestResult } from '../suggest/suggest.ts';
import type { AppDeps } from '../web/app.ts';
import { defaultDeadline } from './plan-rules.ts';

export type Suggestion = { id: string; city: string; area: string; timeWindow: string } & (
  | {
      outcome: 'ok';
      format: string;
      venue: string;
      gatheringAt: Temporal.Instant;
      minimum: number;
      commitDeadlineAt: Temporal.Instant;
    }
  | { outcome: 'failed'; failureReason: FailureReason }
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stores one suggestions row, ok or failed, and returns its id. */
export async function recordSuggestion(
  deps: Pick<AppDeps, 'db' | 'now'>,
  input: SuggestInput,
  result: SuggestResult,
): Promise<string> {
  const base = { ...input, latencyMs: result.latencyMs };
  const values =
    result.outcome === 'ok'
      ? {
          ...base,
          outcome: 'ok' as const,
          format: result.proposal.format,
          venue: result.proposal.venue,
          venueAddress: result.proposal.venueAddress,
          venueUrl: result.proposal.venueUrl,
          gatheringAt: new Date(result.proposal.gatheringAt.epochMilliseconds),
          minimum: result.proposal.minimum,
          commitDeadlineAt: new Date(
            defaultDeadline(deps.now(), result.proposal.gatheringAt).epochMilliseconds,
          ),
        }
      : { ...base, outcome: 'failed' as const, failureReason: result.failureReason };
  const [row] = await deps.db.insert(suggestions).values(values).returning({ id: suggestions.id });
  return row!.id;
}

/** The stored suggestion, or null for a non-UUID (without a query) and for no row. */
export async function loadSuggestion(db: Db, id: string): Promise<Suggestion | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(suggestions).where(eq(suggestions.id, id));
  if (!row) return null;
  const base = { id: row.id, city: row.city, area: row.area, timeWindow: row.timeWindow };
  if (row.outcome === 'failed') return { ...base, outcome: 'failed', failureReason: row.failureReason! };
  return {
    ...base,
    outcome: 'ok',
    format: row.format!,
    venue: row.venue!,
    gatheringAt: Temporal.Instant.fromEpochMilliseconds(row.gatheringAt!.getTime()),
    minimum: row.minimum!,
    commitDeadlineAt: Temporal.Instant.fromEpochMilliseconds(row.commitDeadlineAt!.getTime()),
  };
}

export async function countSuggestions(db: Db): Promise<number> {
  const [row] = await db.select({ value: count() }).from(suggestions);
  return row!.value;
}
