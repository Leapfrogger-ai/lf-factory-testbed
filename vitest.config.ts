import { defineConfig } from 'vitest/config';

const port = Number(process.env.FACTORY_PORT_BASE ?? 20000) + 2;
const database = process.env.FACTORY_DB_NAME ?? 'calvin_test';

export default defineConfig({
  test: {
    globalSetup: ['tests/support/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    env: {
      TEST_DATABASE_URL: `postgres://postgres:calvin@127.0.0.1:${port}/${database}`,
    },
  },
});
