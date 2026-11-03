import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { planForm, sameOrigin, testDeps, TEST_BASE_URL } from '../../../tests/support/builders.ts';
import { resetDb, testDb } from '../../../tests/support/db.ts';
import { fakeSuggest, fixedClock } from '../../../tests/support/fakes.ts';
import { loadFixture } from '../../../tests/support/fixtures.ts';
import { countPlans, loadPlan, loadPublicPlan } from '../../domain/plans.ts';
import { loadSuggestion } from '../../domain/suggestions.ts';
import { createApp } from '../app.ts';

const { db, pool } = testDb();

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

async function post(deps: ReturnType<typeof testDeps>, overrides: Record<string, string> = {}) {
  const app = createApp(deps, { baseUrl: TEST_BASE_URL });
  return app.request('/plans', {
    method: 'POST',
    headers: sameOrigin,
    body: new URLSearchParams(planForm(overrides)),
  });
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
  async function rejected(overrides: Record<string, string>, ...messages: string[]) {
    const deps = testDeps();
    const res = await post(deps, overrides);
    const body = await res.text();

    expect(res.status).toBe(422);
    for (const message of messages) expect(body).toContain(message);
    const kept = [
      ['venue', 'Blue Bottle'],
      ['format', 'coffee'],
      ['name', 'Ann'],
    ] as const;
    for (const [field, value] of kept) {
      if (!(field in overrides)) expect(body).toContain(value);
    }
    expect(await countPlans(db)).toBe(0);
    expect(deps.fakes.planWorkflows.startCalls).toHaveLength(0);
    return body;
  }

  it('rejects a gathering in the past', async () => {
    await rejected({ date: '2026-11-01' }, 'The gathering needs to be in the future.');
  });

  it('rejects a missing or malformed date', async () => {
    for (const date of ['', '2026-13-45', 'tomorrow']) await rejected({ date }, 'Pick a date.');
  });

  it('rejects a missing or malformed time', async () => {
    for (const time of ['', '25:00', '10am']) await rejected({ time }, 'Pick a time.');
  });

  it('rejects a gathering exactly at the current time', async () => {
    await rejected({ date: '2026-11-09', time: '10:00' }, 'The gathering needs to be in the future.');
  });

  it('rejects a minimum of 1 and any value that is not a whole number of at least 2, never a 500', async () => {
    for (const minimum of ['1', '2.5', 'abc', '-3', '', '99999999999']) {
      const body = await rejected({ minimum }, 'The minimum is at least 2 people, you included.');

      expect(body).not.toContain('Keep it under');
    }
  });

  it('publishes a minimum of 40', async () => {
    const res = await post(testDeps(), { minimum: '40' });

    expect(res.status).toBe(303);
    const plan = await publishedPlan(res);
    expect((await loadPublicPlan(db, plan?.publicToken ?? ''))?.minimum).toBe(40);
  });

  it('rejects a deadline after the gathering, under Decide by', async () => {
    const body = await rejected(
      { deadlineDate: '2026-11-14', deadlineTime: '18:00' },
      'The decide-by time needs to be before the gathering.',
    );

    expect(body).toMatch(/id="deadlineDate-error"[^>]*>[^<]*The decide-by time needs to be before the gathering\./);
  });

  it('rejects a deadline in the past, under Decide by, keeping the values', async () => {
    const body = await rejected(
      { deadlineDate: '2026-11-01', deadlineTime: '09:00' },
      'The decide-by time needs to be in the future.',
    );

    expect(body).toMatch(/id="deadlineDate-error"[^>]*>[^<]*The decide-by time needs to be in the future\./);
    expect(body).toContain('value="2026-11-01"');
    expect(body).toContain('value="09:00"');
  });

  it('rejects a deadline exactly at the gathering, under Decide by', async () => {
    const body = await rejected(
      { deadlineDate: '2026-11-14', deadlineTime: '10:00' },
      'The decide-by time needs to be before the gathering.',
    );

    expect(body).toMatch(/id="deadlineDate-error"[^>]*>[^<]*The decide-by time needs to be before the gathering\./);
  });

  it('shows a deadline error together with a field error', async () => {
    const body = await rejected(
      { venue: '', deadlineDate: '2026-11-01', deadlineTime: '09:00' },
      'Add where it is.',
      'The decide-by time needs to be in the future.',
    );

    expect(body).toMatch(/id="deadlineDate-error"[^>]*>[^<]*The decide-by time needs to be in the future\./);
  });

  it('rejects only one of the deadline date and time, under Decide by', async () => {
    const onlyOne: Record<string, string>[] = [{ deadlineDate: '2026-11-12' }, { deadlineTime: '09:00' }];
    for (const overrides of onlyOne) {
      const body = await rejected(overrides, 'Pick both a date and a time, or leave both empty.');

      expect(body).toMatch(/id="deadlineDate-error"[^>]*>[^<]*Pick both a date and a time, or leave both empty\./);
    }
  });

  it('shows a schema error and a timing error together', async () => {
    const body = await rejected(
      { email: 'nope', date: '2026-11-01' },
      'The gathering needs to be in the future.',
    );

    expect(body).toContain('That email doesn&#39;t look right.');
  });

  it('rejects no city, empty area, empty rough time, each in its own error element', async () => {
    const body = await rejected({ city: '', area: '', timeWindow: '' }, 'Pick a city.', 'Add a rough area.', 'Add a rough time.');

    expect(body).toMatch(/id="city-error"[^>]*>[^<]*Pick a city\./);
    expect(body).toMatch(/id="area-error"[^>]*>[^<]*Add a rough area\./);
    expect(body).toMatch(/id="timeWindow-error"[^>]*>[^<]*Add a rough time\./);
    expect(body).toContain('coffee');
    expect(body).toContain('Ann');
  });

  it('rejects a city that is not in CITIES', async () => {
    await rejected({ city: 'Gotham' }, 'Pick a city.');
  });

  it('rejects an empty format and an empty venue', async () => {
    await rejected({ format: '', venue: '' }, 'Say what it is, like coffee or a walk.', 'Add where it is.');
  });

  it('rejects a venue of 121 characters and publishes one of exactly 120', async () => {
    await rejected({ venue: 'v'.repeat(121) }, 'Keep it under 120 characters.');

    const res = await post(testDeps(), { venue: 'v'.repeat(120) });
    expect(res.status).toBe(303);
  });

  it('rejects a venue of only spaces', async () => {
    await rejected({ venue: '     ' }, 'Add where it is.');
  });

  it('rejects an empty name and the email "ana@"', async () => {
    await rejected({ name: '', email: 'ana@' }, 'Add your name.', 'That email doesn&#39;t look right.');
  });

  it('escapes entered values when re-rendering', async () => {
    const body = await rejected({ name: '<script>x</script> & Co', email: 'nope' }, "That email doesn&#39;t look right.");

    expect(body).toContain('&lt;script&gt;');
    expect(body).not.toContain('<script>x');
  });
});

async function postSuggest(deps: ReturnType<typeof testDeps>, fields: Record<string, string> = {}) {
  const app = createApp(deps, { baseUrl: TEST_BASE_URL });
  return app.request('/suggest', {
    method: 'POST',
    headers: sameOrigin,
    body: new URLSearchParams({ city: 'Oakland', area: 'Rockridge', timeWindow: 'next weekend, morning', ...fields }),
  });
}

describe('POST /suggest', () => {
  it('redirects 303 to /?suggestion=<id> and stores one ok row (AC1)', async () => {
    const fake = fakeSuggest(loadFixture('good'));

    const res = await postSuggest(testDeps({ suggestPlanCall: fake.call }));

    expect(res.status).toBe(303);
    const location = res.headers.get('location') ?? '';
    expect(location).toMatch(/^\/\?suggestion=[0-9a-f-]{36}$/);
    expect(fake.calls).toHaveLength(1);
    const stored = await loadSuggestion(db, location.split('=')[1] ?? '');
    expect(stored).toMatchObject({ outcome: 'ok', venue: 'Highwire Coffee Roasters' });
  });

  it.each([
    ['no-tool-call', 'no_proposal'],
    ['pause-turn', 'pause_turn'],
    ['refusal', 'refusal'],
    ['max-tokens', 'max_tokens'],
    ['an API error', 'api_error'],
  ] as const)('stores a failed row and still redirects for %s (AC3)', async (name, failureReason) => {
    const fake = fakeSuggest(name === 'an API error' ? undefined : loadFixture(name));
    if (name === 'an API error') fake.failWith(new Error('upstream down'));

    const res = await postSuggest(testDeps({ suggestPlanCall: fake.call }));

    expect(res.status).toBe(303);
    const stored = await loadSuggestion(db, (res.headers.get('location') ?? '').split('=')[1] ?? '');
    expect(stored).toMatchObject({ outcome: 'failed', failureReason });
  });

  it.each([
    ['empty inputs', { city: '', area: '', timeWindow: '' }],
    ['whitespace and an unknown city', { city: 'Gotham', area: '   ', timeWindow: '  ' }],
  ])('answers 422 with the three messages and never calls Claude for %s (AC5)', async (_name, fields) => {
    const fake = fakeSuggest(loadFixture('good'));

    const res = await postSuggest(testDeps({ suggestPlanCall: fake.call }), fields);

    expect(res.status).toBe(422);
    const body = await res.text();
    expect(body).toContain('Pick a city.');
    expect(body).toContain('Add a rough area.');
    expect(body).toContain('Add a rough time.');
    expect(fake.calls).toHaveLength(0);
  });

  it('keeps what was entered when it answers 422 (AC5)', async () => {
    const res = await postSuggest(testDeps(), { area: 'Rockridge', timeWindow: '' });

    expect(res.status).toBe(422);
    expect(await res.text()).toContain('Rockridge');
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
