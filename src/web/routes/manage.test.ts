import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { planForm, publishPlan, sameOrigin, testDeps, TEST_BASE_URL } from '../../../tests/support/builders.ts';
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
    expect(body).toContain("We couldn't email you your private link. Bookmark the link below to manage the plan.");
  });

  it('has the copy and share hooks and the share text (AC6)', async () => {
    const deps = testDeps();
    const { manageToken } = await publishPlan(deps);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    const body = await (await app.request(`/m/${manageToken}/published`)).text();

    expect(body).toContain(
      'data-share-text="Coffee at Blue Bottle, Sat 14 Nov 10:00 AM — I&#39;m in, who else?"',
    );
    expect(body).toMatch(/<button type="button" id="share"[^>]*hidden[^>]*>Share…<\/button>/);
    expect(body).toMatch(/id="public-link"/);
    expect(body).toMatch(/<button type="button" id="copy"/);
    expect(body).toMatch(/aria-live="polite"/);
  });

  it('loads create.js under the response nonce', async () => {
    const deps = testDeps();
    const { manageToken } = await publishPlan(deps);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    const res = await app.request(`/m/${manageToken}/published`);

    const nonce = /'nonce-([^']+)'/.exec(res.headers.get('content-security-policy') ?? '')?.[1];
    expect(nonce).toBeTruthy();
    expect(await res.text()).toContain(`<script src="/static/create.js" nonce="${nonce}" defer></script>`);
  });

  it('says the link was emailed after publishing through the form (AC2)', async () => {
    const deps = testDeps();
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });
    const posted = await app.request('/plans', {
      method: 'POST',
      headers: sameOrigin,
      body: new URLSearchParams(planForm()),
    });

    const res = await app.request(posted.headers.get('location') ?? '');

    const body = await res.text();
    expect(body).toContain("We've emailed you a private link to manage the plan. Keep it to yourself.");
    expect(body).not.toContain("We couldn't email you");
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
