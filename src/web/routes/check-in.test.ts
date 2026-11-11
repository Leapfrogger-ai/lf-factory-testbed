import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { publishPlan, testDeps, TEST_BASE_URL } from '../../../tests/support/builders.ts';
import { resetDb, testDb } from '../../../tests/support/db.ts';
import { callOff, commit, loadPlan } from '../../domain/plans.ts';
import { commitFormSchema } from '../forms.ts';
import { newToken } from '../../domain/tokens.ts';
import { createApp } from '../app.ts';

const { db, pool } = testDb();

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

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

const form = (name: string, email: string) => commitFormSchema.parse({ name, email });

// Ann plus Mia and Raj make 3 of 3, which confirms the plan.
async function confirmedPlan() {
  const deps = testDeps();
  const published = await publishPlan(deps, { name: 'Ann', email: 'ann@example.test' });
  await commit(deps, published.publicToken, form('Mia Chen', 'mia@example.test'));
  await commit(deps, published.publicToken, form('Raj Patel', 'raj@example.test'));
  const plan = (await loadPlan(db, published.manageToken))!;
  const app = createApp(deps, { baseUrl: TEST_BASE_URL });
  return { deps, app, published, token: plan.checkInToken };
}

const answered = async (manageToken: string) => (await loadPlan(db, manageToken))!;
const answeredEvents = (plan: { events: { type: string }[] }) => plan.events.filter((e) => e.type === 'check_in.answered');

describe('GET /c/:token/:question/:answer', () => {
  it('records happened/yes and offers the attended question (AC1)', async () => {
    const { app, published, token } = await confirmedPlan();

    const res = await app.request(`/c/${token}/happened/yes`);

    expect(res.status).toBe(200);
    const body = decodeEntities(await res.text());
    expect(body).toContain('Thanks! Got it: it happened.');
    expect(body).toContain('Were you there?');
    expect(body).toContain('class="answers"');
    expect(body).toContain(`class="btn btn-primary" href="/c/${token}/attended/yes"`);
    expect(body).toContain(`class="btn btn-secondary" href="/c/${token}/attended/no"`);
    const thanksAt = body.indexOf('Thanks! Got it: it happened.');
    expect(body.indexOf('Coffee at Blue Bottle')).toBeGreaterThan(-1);
    expect(body.indexOf('Coffee at Blue Bottle')).toBeLessThan(thanksAt);
    expect(body.indexOf('Sat 14 Nov · 10:00 AM')).toBeGreaterThan(-1);
    expect(body.indexOf('Sat 14 Nov · 10:00 AM')).toBeLessThan(thanksAt);
    const plan = await answered(published.manageToken);
    expect(plan.checkInAnswers).toEqual([{ question: 'happened', answer: true }]);
    expect(answeredEvents(plan)).toHaveLength(1);
  });

  it('replaces an earlier answer (AC2)', async () => {
    const { app, published, token } = await confirmedPlan();

    await app.request(`/c/${token}/happened/yes`);
    const res = await app.request(`/c/${token}/happened/no`);

    expect(decodeEntities(await res.text())).toContain("Thanks! Got it: it didn't happen.");
    const plan = await answered(published.manageToken);
    expect(plan.checkInAnswers).toEqual([{ question: 'happened', answer: false }]);
    expect(answeredEvents(plan)).toHaveLength(2);
  });

  it('after happened/no still asks Were you there?', async () => {
    const { app, token } = await confirmedPlan();

    const res = await app.request(`/c/${token}/happened/no`);

    const body = decodeEntities(await res.text());
    expect(body).toContain("Thanks! Got it: it didn't happen.");
    expect(body).toContain('Were you there?');
    expect(body).toContain(`href="/c/${token}/attended/yes"`);
    expect(body).toContain(`href="/c/${token}/attended/no"`);
  });

  it('shows the finished page once both are answered (AC3)', async () => {
    const { app, token } = await confirmedPlan();

    await app.request(`/c/${token}/happened/yes`);
    const res = await app.request(`/c/${token}/attended/yes`);

    const body = decodeEntities(await res.text());
    expect(body).toContain('Coffee at Blue Bottle');
    expect(body).toContain('Sat 14 Nov · 10:00 AM');
    expect(body).toContain('Thanks! Got it: you were there.');
    expect(body).toContain('Tapped the wrong one? Use the links in the email again; the last tap counts.');
    expect(body).toContain('<a class="quiet" href="/">Suggest another plan</a>');
    expect(body).not.toContain('Did it happen?');
    expect(body).not.toContain('Were you there?');
    expect(body).not.toContain('href="/c/');
    expect(body).not.toContain('btn-primary');
  });

  it('re-answering after both are answered still shows the finished page', async () => {
    const { app, token } = await confirmedPlan();

    await app.request(`/c/${token}/happened/yes`);
    await app.request(`/c/${token}/attended/yes`);
    const res = await app.request(`/c/${token}/happened/no`);

    const body = decodeEntities(await res.text());
    expect(body).toContain("Thanks! Got it: it didn't happen.");
    expect(body).not.toContain('href="/c/');
  });

  it('offers happened after attended/yes first (AC4)', async () => {
    const { app, token } = await confirmedPlan();

    const res = await app.request(`/c/${token}/attended/yes`);

    const body = decodeEntities(await res.text());
    expect(body).toContain('Thanks! Got it: you were there.');
    expect(body).toContain('Did it happen?');
    expect(body).toContain(`href="/c/${token}/happened/yes"`);
    expect(body).toContain(`href="/c/${token}/happened/no"`);
  });

  type Context = Awaited<ReturnType<typeof confirmedPlan>>;
  it.each([
    [
      'a called-off plan',
      async (c: Context) => {
        await callOff(c.deps, c.published.manageToken);
        return `/c/${c.token}/happened/yes`;
      },
    ],
    ['an unknown well-formed token', async () => `/c/${newToken()}/happened/yes`],
    ['a malformed token', async () => '/c/short/happened/yes'],
    ['an unknown question', async (c: Context) => `/c/${c.token}/maybe/yes`],
    ['an unknown answer', async (c: Context) => `/c/${c.token}/happened/perhaps`],
    [
      "the creator's withdraw token",
      async (c: Context) => {
        const plan = (await loadPlan(db, c.published.manageToken))!;
        return `/c/${plan.commits.find((m) => m.isCreator)!.withdrawToken}/happened/yes`;
      },
    ],
  ])('answers 404 and records nothing for %s (AC5)', async (_name, path) => {
    const context = await confirmedPlan();
    const url = await path(context);

    const res = await context.app.request(url);
    const unknown = await context.app.request('/nope');

    expect(res.status).toBe(404);
    expect(await res.text()).toBe(await unknown.text());
    const plan = await answered(context.published.manageToken);
    expect(plan.checkInAnswers).toEqual([]);
    expect(answeredEvents(plan)).toEqual([]);
  });

  it('a malformed link is 404 without a database query (AC5)', async () => {
    const throwingDb = new Proxy(
      {},
      {
        get() {
          throw new Error('database touched');
        },
      },
    ) as ReturnType<typeof testDeps>['db'];
    const app = createApp(testDeps({ db: throwingDb }), { baseUrl: TEST_BASE_URL });
    const unknown = await (await app.request('/nope')).text();

    for (const path of [
      '/c/short/happened/yes',
      `/c/${'a'.repeat(42)}./happened/yes`,
      '/c/short/maybe/perhaps',
      `/c/${newToken()}/maybe/yes`,
      `/c/${newToken()}/happened/perhaps`,
    ]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toBe(unknown);
    }
  });

  it('is noindex, has generic OG tags and leaks no email or committer name (AC6)', async () => {
    const { app, token } = await confirmedPlan();

    const res = await app.request(`/c/${token}/happened/yes`);

    const body = decodeEntities(await res.text());
    expect(body).toContain('<meta name="robots" content="noindex"');
    expect(body).toContain('<meta property="og:title" content="Calvin"');
    for (const leak of ['@', 'example.test', 'Mia', 'Raj', 'Ann']) expect(body).not.toContain(leak);
    expect(body).toContain('Coffee at Blue Bottle');
  });
});
