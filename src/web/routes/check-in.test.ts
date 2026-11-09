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
    expect(body).toContain(`href="/c/${token}/attended/yes"`);
    expect(body).toContain(`href="/c/${token}/attended/no"`);
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

  it('shows no other question once both are answered (AC3)', async () => {
    const { app, token } = await confirmedPlan();

    await app.request(`/c/${token}/happened/yes`);
    const res = await app.request(`/c/${token}/attended/no`);

    const body = decodeEntities(await res.text());
    expect(body).toContain("Thanks! Got it: you weren't there.");
    expect(body).not.toContain('Did it happen?');
    expect(body).not.toContain('Were you there?');
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

  it('is noindex, has generic OG tags and leaks no email or committer name (AC6)', async () => {
    const { app, token } = await confirmedPlan();

    const res = await app.request(`/c/${token}/happened/yes`);

    const body = decodeEntities(await res.text());
    expect(body).toContain('<meta name="robots" content="noindex"');
    expect(body).toContain('<meta property="og:title" content="Calvin"');
    for (const leak of ['@', 'example.test', 'Mia', 'Raj', 'Ann', 'Blue Bottle']) expect(body).not.toContain(leak);
  });
});
