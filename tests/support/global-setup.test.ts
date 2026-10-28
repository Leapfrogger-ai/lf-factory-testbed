import pg from 'pg';
import { expect, it } from 'vitest';

it('provides a migrated Postgres 17 at the spec-defined URL', async () => {
  const port = Number(process.env.FACTORY_PORT_BASE ?? 20000) + 2;
  const name = process.env.FACTORY_DB_NAME ?? 'calvin_test';
  expect(process.env.TEST_DATABASE_URL).toBe(
    `postgres://postgres:calvin@127.0.0.1:${port}/${name}`,
  );

  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const tables = await client.query(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const names = tables.rows.map((r: { table_name: string }) => r.table_name);
    for (const t of ['suggestions', 'plans', 'commits', 'email_sends', 'check_in_answers', 'events']) {
      expect(names).toContain(t);
    }
    const version = await client.query('select version() as version');
    expect(version.rows[0].version).toMatch(/PostgreSQL 17/);
  } finally {
    await client.end();
  }
});
