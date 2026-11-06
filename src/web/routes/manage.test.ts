import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { planForm, publishPlan, sameOrigin, testDeps, TEST_BASE_URL } from '../../../tests/support/builders.ts';
import { resetDb, testDb } from '../../../tests/support/db.ts';
import { fixedClock } from '../../../tests/support/fakes.ts';
import { commit } from '../../domain/plans.ts';
import { newToken } from '../../domain/tokens.ts';
import { createApp } from '../app.ts';
import { commitFormSchema } from '../forms.ts';

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

const creator = { name: 'Ana Ruiz', email: 'ana@example.test' };

function join(deps: ReturnType<typeof testDeps>, publicToken: string, name: string, email: string) {
  return commit(deps, publicToken, commitFormSchema.parse({ name, email }));
}

describe('GET /m/:token', () => {
  it('shows the example plan (AC1)', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps, creator);
    await join(deps, publicToken, 'Mia Chen', 'mia@example.test');
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    const res = await app.request(`/m/${manageToken}`);

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Your plan. Only you can see this page.');
    expect(body).toContain('Needs 1 more · decide by');
    expect(body).toContain('Ana Ruiz');
    expect(body).toContain('Mia Chen');
    expect(body).toContain(`https://calvin.test/p/${publicToken}`);
    expect(body).toContain(`href="/m/${manageToken}/new"`);
    expect(body).toContain(`action="/m/${manageToken}/call-off"`);
    expect(body).toContain('<meta name="robots" content="noindex"');
    expect(body).not.toContain('example.test');
  });

  it("shows It's on for a confirmed plan (AC3)", async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps, creator);
    await join(deps, publicToken, 'Mia Chen', 'mia@example.test');
    await join(deps, publicToken, 'Raj Rao', 'raj@example.test');
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    const body = await (await app.request(`/m/${manageToken}`)).text();

    expect(body).toContain('pill state-on');
    expect(body).toContain('names names-on');
  });

  it('shows Not this time once called off (AC4)', async () => {
    const deps = testDeps();
    const { manageToken } = await publishPlan(deps, creator);
    const app = createApp({ ...deps, now: fixedClock('2026-11-12T06:00:00Z') }, { baseUrl: TEST_BASE_URL });

    const body = await (await app.request(`/m/${manageToken}`)).text();

    expect(body).toContain('pill state-off');
    expect(body).toContain('names-off');
    expect(body).toContain('Who was in');
    expect(body).not.toContain('Call it off');
  });

  it('has no call-off once the gathering started (AC5)', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps, creator);
    await join(deps, publicToken, 'Mia Chen', 'mia@example.test');
    await join(deps, publicToken, 'Raj Rao', 'raj@example.test');
    const app = createApp({ ...deps, now: fixedClock('2026-11-14T18:00:01Z') }, { baseUrl: TEST_BASE_URL });

    const body = await (await app.request(`/m/${manageToken}`)).text();

    expect(body).toContain('Happening now');
    expect(body).not.toContain('Call it off');
  });

  it('renders the too-late notice', async () => {
    const deps = testDeps();
    const { manageToken } = await publishPlan(deps, creator);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    const shown = await (await app.request(`/m/${manageToken}?notice=too-late`)).text();
    const other = await (await app.request(`/m/${manageToken}?notice=anything-else`)).text();

    expect(shown).toContain("It's already started, so it can't be called off.");
    expect(other).not.toContain('role="status"');
  });

  it('404s an unknown token, and a malformed one without a query (AC7)', async () => {
    const throwingDb = new Proxy(
      {},
      {
        get() {
          throw new Error('database touched');
        },
      },
    ) as ReturnType<typeof testDeps>['db'];
    const app = createApp(testDeps({ db: throwingDb }), { baseUrl: TEST_BASE_URL });
    const real = createApp(testDeps(), { baseUrl: TEST_BASE_URL });

    const unknown = await real.request(`/m/${newToken()}`);
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain("We can't find that plan.");
    for (const token of ['not-a-token', 'a'.repeat(200)]) {
      const res = await app.request(`/m/${token}`);
      expect(res.status).toBe(404);
      expect(await res.text()).toContain('noindex');
    }
  });

  it('loads create.js under the response nonce', async () => {
    const deps = testDeps();
    const { manageToken } = await publishPlan(deps, creator);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    const res = await app.request(`/m/${manageToken}`);

    const nonce = /'nonce-([^']+)'/.exec(res.headers.get('content-security-policy') ?? '')?.[1];
    expect(nonce).toBeTruthy();
    expect(await res.text()).toContain(`<script src="/static/create.js" nonce="${nonce}" defer></script>`);
  });
});
