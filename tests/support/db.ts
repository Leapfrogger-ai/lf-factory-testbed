import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { createDb, type Db } from '../../src/db/client.ts';

let shared: { db: Db; pool: pg.Pool } | undefined;

/** One pool per test file, so tests never leak connections. */
export function testDb(): { db: Db; pool: pg.Pool } {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  shared ??= createDb(url);
  return shared;
}

export async function resetDb(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE suggestions, plans, commits, email_sends, check_in_answers, events RESTART IDENTITY CASCADE`,
  );
}
