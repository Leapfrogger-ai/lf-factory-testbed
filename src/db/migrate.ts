import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as runMigrations } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export async function migrate(databaseUrl: string, migrationsFolder = 'drizzle'): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await runMigrations(drizzle(pool, { casing: 'snake_case' }), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  await migrate(databaseUrl);
}
