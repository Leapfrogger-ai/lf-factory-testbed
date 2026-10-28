import { rm } from 'node:fs/promises';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { migrate } from '../../src/db/migrate.ts';

const databaseDir = '.factory/pgdata';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const url = new URL(project.config.env.TEST_DATABASE_URL as string);
  const database = decodeURIComponent(url.pathname.slice(1));

  await rm(databaseDir, { recursive: true, force: true });
  const server = new EmbeddedPostgres({
    databaseDir,
    port: Number(url.port),
    user: url.username,
    password: url.password,
    persistent: false,
    postgresFlags: ['-c', 'unix_socket_directories='],
  });
  await server.initialise();
  await server.start();

  const adminUrl = new URL(url.href);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.href });
  await admin.connect();
  try {
    const existing = await admin.query('select 1 from pg_database where datname = $1', [database]);
    if (existing.rowCount === 0) {
      await admin.query(`create database "${database.replaceAll('"', '""')}"`);
    }
  } finally {
    await admin.end();
  }

  await migrate(url.href);
  return () => server.stop();
}
