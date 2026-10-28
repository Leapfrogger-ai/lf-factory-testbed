import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { publishPlan, testDeps, TEST_BASE_URL } from '../../../tests/support/builders.ts';
import { resetDb, testDb } from '../../../tests/support/db.ts';
import { newToken } from '../../domain/tokens.ts';
import { createApp } from '../app.ts';

const { db, pool } = testDb();

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

describe('GET /m/:token/published', () => {
  it('shows the share link and the manage link', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    const res = await app.request(`/m/${manageToken}/published`);

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Your plan is ready to share');
    expect(body).toContain(`https://calvin.test/p/${publicToken}`);
    expect(body).toMatch(new RegExp(`href="/m/${manageToken}"[^>]*>\\s*Manage your plan`));
    expect(body).not.toContain('ann@example.test');
    expect(body).toContain('noindex');
  });

  it('unknown token is 404', async () => {
    const app = createApp(testDeps(), { baseUrl: TEST_BASE_URL });

    const res = await app.request(`/m/${newToken()}/published`);

    expect(res.status).toBe(404);
    expect(await res.text()).toContain("We can't find that plan.");
  });

  it('malformed token is 404 without a database query', async () => {
    const throwingDb = new Proxy(
      {},
      {
        get() {
          throw new Error('database touched');
        },
      },
    ) as ReturnType<typeof testDeps>['db'];
    const app = createApp(testDeps({ db: throwingDb }), { baseUrl: TEST_BASE_URL });

    for (const token of ['short', 'a'.repeat(44)]) {
      const res = await app.request(`/m/${token}/published`);
      expect(res.status).toBe(404);
    }
  });
});
