import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { planForm, testDeps, TEST_BASE_URL } from '../../../tests/support/builders.ts';
import { resetDb, testDb } from '../../../tests/support/db.ts';
import { fixedClock } from '../../../tests/support/fakes.ts';
import { countPlans, loadPlan } from '../../domain/plans.ts';
import { createApp } from '../app.ts';

const { db, pool } = testDb();

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

async function post(deps: ReturnType<typeof testDeps>, overrides: Record<string, string> = {}) {
  const app = createApp(deps, { baseUrl: TEST_BASE_URL });
  return app.request('/plans', { method: 'POST', body: new URLSearchParams(planForm(overrides)) });
}

async function publishedPlan(res: Response) {
  const location = res.headers.get('location') ?? '';
  const token = location.split('/')[2] ?? '';
  return loadPlan(db, token);
}

describe('POST /plans', () => {
  it('publishes and redirects to the published page with the default deadline (AC1)', async () => {
    const res = await post(testDeps());

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/m\/[A-Za-z0-9_-]{43}\/published$/);
    const plan = await publishedPlan(res);
    expect(plan?.gatheringAt).toBe('2026-11-14T18:00:00Z');
    expect(plan?.commitDeadlineAt).toBe('2026-11-12T06:00:00Z');
  });

  it('defaults the deadline to 48 hours before the gathering when there is time (AC2)', async () => {
    const res = await post(testDeps({ now: fixedClock('2026-11-11T18:00:00Z') }));

    expect((await publishedPlan(res))?.commitDeadlineAt).toBe('2026-11-12T18:00:00Z');
  });

  it('defaults the deadline to halfway when the gathering is under 48 hours away (AC3)', async () => {
    const res = await post(testDeps({ now: fixedClock('2026-11-13T18:00:00Z') }));

    expect((await publishedPlan(res))?.commitDeadlineAt).toBe('2026-11-14T06:00:00Z');
  });

  it('uses a deadline the creator entered (AC4)', async () => {
    const res = await post(testDeps(), { deadlineDate: '2026-11-13', deadlineTime: '18:00' });

    expect((await publishedPlan(res))?.commitDeadlineAt).toBe('2026-11-14T02:00:00Z');
  });

  it('starts the workflow once with the schedule (AC7)', async () => {
    const deps = testDeps();
    await post(deps);

    expect(deps.fakes.planWorkflows.startCalls).toHaveLength(1);
    expect(deps.fakes.planWorkflows.startCalls[0]?.schedule).toEqual({
      deadlineAt: '2026-11-12T06:00:00Z',
      reminder24At: '2026-11-13T18:00:00Z',
      reminderMorningAt: '2026-11-14T16:00:00Z',
      checkInAt: '2026-11-15T18:00:00Z',
    });
  });

  it('answers 500 with the system error page and stores nothing when the workflow cannot start (AC11)', async () => {
    const deps = testDeps();
    deps.fakes.planWorkflows.failStart(new Error('temporal down'));

    const res = await post(deps);

    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain('Something went wrong. Go back and try again.');
    expect(body).not.toMatch(/\bat /);
    expect(body).not.toContain('temporal down');
    expect(await countPlans(db)).toBe(0);
  });
});

describe('POST /plans validation', () => {
  async function rejected(overrides: Record<string, string>, message: string) {
    const deps = testDeps();
    const res = await post(deps, overrides);
    const body = await res.text();

    expect(res.status).toBe(422);
    expect(body).toContain(message);
    expect(body).toContain('Blue Bottle');
    expect(await countPlans(db)).toBe(0);
    expect(deps.fakes.planWorkflows.startCalls).toHaveLength(0);
    return body;
  }

  it('rejects a gathering in the past', async () => {
    await rejected({ date: '2026-11-01' }, 'The gathering needs to be in the future.');
  });

  it('rejects a deadline after the gathering', async () => {
    await rejected(
      { deadlineDate: '2026-11-14', deadlineTime: '18:00' },
      'The decide-by time needs to be before the gathering.',
    );
  });

  it('rejects a deadline in the past', async () => {
    await rejected(
      { deadlineDate: '2026-11-01', deadlineTime: '09:00' },
      'The decide-by time needs to be in the future.',
    );
  });

  it('rejects only one of the deadline date and time', async () => {
    await rejected({ deadlineDate: '2026-11-12' }, 'Pick both a date and a time, or leave both empty.');
  });

  it('shows a schema error and a timing error together', async () => {
    const body = await rejected(
      { email: 'nope', date: '2026-11-01' },
      'The gathering needs to be in the future.',
    );

    expect(body).toContain('That email doesn&#39;t look right.');
  });

  it('escapes entered values when re-rendering', async () => {
    const body = await rejected({ name: '<script>x</script> & Co', email: 'nope' }, "That email doesn&#39;t look right.");

    expect(body).toContain('&lt;script&gt;');
    expect(body).not.toContain('<script>x');
  });
});

describe('GET /', () => {
  it('renders the create page linking the stylesheet (AC1)', async () => {
    const app = createApp(testDeps(), { baseUrl: TEST_BASE_URL });

    const res = await app.request('/');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('/static/app.css');
    expect(body).toContain('Publish plan');
  });
});

describe('GET /static/app.css', () => {
  it('serves the stylesheet with light and dark tokens, cached for a day', async () => {
    const app = createApp(testDeps(), { baseUrl: TEST_BASE_URL });

    const res = await app.request('/static/app.css');

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
    const css = await res.text();
    expect(css).toContain('prefers-color-scheme: dark');
    expect(css).toContain('#FBF7F2');
    expect(css).toContain('#1E1A17');
  });
});
