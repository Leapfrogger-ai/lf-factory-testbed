import { defineConfig } from 'vitest/config';

// The Epic 4 showcase: not part of `npm test` (its file doesn't end in .test.ts).
// Its own database name and port, so it never touches the test run's.
const port = Number(process.env.FACTORY_PORT_BASE ?? 20100) + 2;

export default defineConfig({
  test: {
    include: ['specs/calvin-5/showcase/capture.showcase.ts'],
    globalSetup: ['tests/support/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 0,
    hookTimeout: 120_000,
    env: {
      TEST_DATABASE_URL: `postgres://postgres:calvin@127.0.0.1:${port}/calvin_showcase`,
    },
  },
});
