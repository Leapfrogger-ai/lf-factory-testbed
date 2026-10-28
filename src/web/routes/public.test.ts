import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { publishPlan, testDeps, TEST_BASE_URL } from '../../../tests/support/builders.ts';
import { resetDb, testDb } from '../../../tests/support/db.ts';
import { fixedClock } from '../../../tests/support/fakes.ts';
import { newToken } from '../../domain/tokens.ts';
import { createApp } from '../app.ts';

const { db, pool } = testDb();

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const NOT_FOUND_COPY = "We can't find that plan. The link may be incomplete. Check it in your chat or email.";

function decodeEntities(html: string): string {
  return html
    .replaceAll('&#39;', "'")
    .replaceAll('&#x27;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

const creator = { name: 'Ana Ruiz', email: 'ana@example.test' };

describe('GET /p/:token', () => {
  it('shows the open plan (AC1)', async () => {
    const deps = testDeps();
    const { publicToken } = await publishPlan(deps, creator);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    const res = await app.request(`/p/${publicToken}`);

    expect(res.status).toBe(200);
    const body = decodeEntities(await res.text());
    expect(body).toContain('Needs 2 more');
    expect(body).toContain('<h1>Blue Bottle</h1>');
    expect(body).toContain('Oakland · Sat 14 Nov · 10:00 AM');
    expect(body).toContain('Ana');
    expect(body).not.toContain('Ruiz');
    expect(body).toContain('you?');
    expect(body).toContain('aria-label="1 of 3 people in"');
    expect(body).toContain('Goes ahead with a minimum of 3. Decide by Wed 11 Nov, 10:00 PM.');
  });

  it('renders no email address and escapes the creator name (AC4, AC3)', async () => {
    const deps = testDeps();
    const { publicToken } = await publishPlan(deps, { ...creator, name: '<b>Bartholomew-Alexander</b> Smith' });
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    const body = await (await app.request(`/p/${publicToken}`)).text();

    expect(body).not.toContain('example.test');
    expect(body).not.toMatch(/[\w.]+@[\w.]+/);
    expect(body).not.toContain('<b>');
    expect(body).toContain('&lt;b&gt;Bartholomew-A');
  });

  it('carries the share-preview tags and noindex (AC5)', async () => {
    const deps = testDeps();
    const { publicToken } = await publishPlan(deps, creator);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    const body = await (await app.request(`/p/${publicToken}`)).text();

    expect(body).toContain('<meta property="og:title" content="Coffee at Blue Bottle"');
    expect(body).toContain(
      '<meta property="og:description" content="Sat 14 Nov · 10:00 AM · Oakland. Goes ahead if 3 are in."',
    );
    expect(body).toContain('<meta property="og:image" content="https://calvin.test/static/og.png"');
    expect(body).toContain('<meta property="og:site_name" content="calvin"');
    expect(body).toContain('<meta name="robots" content="noindex"');
  });

  it('shows Not this time at the commit deadline (AC6)', async () => {
    const deps = testDeps();
    const { publicToken } = await publishPlan(deps, creator);
    const app = createApp({ ...deps, now: fixedClock('2026-11-12T06:00:00Z') }, { baseUrl: TEST_BASE_URL });

    const body = decodeEntities(await (await app.request(`/p/${publicToken}`)).text());

    expect(body).toContain('Not this time');
    expect(body).toContain("This one isn't going ahead. No harm done. Maybe next time.");
    expect(body).toContain('href="/"');
    expect(body).not.toContain('<ul');
  });

  it('unknown token is the 404 page (AC7)', async () => {
    const app = createApp(testDeps(), { baseUrl: TEST_BASE_URL });

    const res = await app.request(`/p/${newToken()}`);

    expect(res.status).toBe(404);
    expect(decodeEntities(await res.text())).toContain(NOT_FOUND_COPY);
  });

  it('bad tokens are 404 without a database query (AC7)', async () => {
    const throwingDb = new Proxy(
      {},
      {
        get() {
          throw new Error('database touched');
        },
      },
    ) as ReturnType<typeof testDeps>['db'];
    const app = createApp(testDeps({ db: throwingDb }), { baseUrl: TEST_BASE_URL });
    const valid = 'a'.repeat(43);

    for (const path of ['/p/short', `/p/${'a'.repeat(44)}`, `/p/${'a'.repeat(42)}.`, '/p/', `/p/${valid}/`]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(decodeEntities(await res.text()), path).toContain(NOT_FOUND_COPY);
    }
  });

  it('links one stylesheet and runs no script (AC8)', async () => {
    const deps = testDeps();
    const { publicToken } = await publishPlan(deps, creator);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    const body = await (await app.request(`/p/${publicToken}`)).text();

    expect(body.match(/<link rel="stylesheet"/g)).toHaveLength(1);
    expect(body).toContain('href="/static/app.css"');
    expect(body).not.toContain('<script');
  });
});
