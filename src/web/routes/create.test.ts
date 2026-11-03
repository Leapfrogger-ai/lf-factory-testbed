import { ApplicationFailure } from '@temporalio/activity';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planForm, sameOrigin, testDeps, TEST_BASE_URL } from '../../../tests/support/builders.ts';
import { resetDb, testDb } from '../../../tests/support/db.ts';
import { fakeSuggest, fixedClock } from '../../../tests/support/fakes.ts';
import { loadFixture } from '../../../tests/support/fixtures.ts';
import { countPlans, loadPlan, loadPublicPlan } from '../../domain/plans.ts';
import { countSuggestions, loadSuggestion } from '../../domain/suggestions.ts';
import { createApp } from '../app.ts';
import { PUBLISH_LIMIT_NOTICE, SUGGEST_LIMIT_NOTICE } from '../views/create-page.ts';

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

describe('POST /plans manage-link email', () => {
  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

  function captureLogs() {
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    });
    return lines;
  }

  afterEach(() => vi.restoreAllMocks());

  it('emails the creator their manage link once (AC1)', async () => {
    const deps = testDeps();
    const res = await post(deps);

    const token = (res.headers.get('location') ?? '').split('/')[2];
    expect(deps.fakes.email.calls).toHaveLength(1);
    const call = deps.fakes.email.calls[0] as { payload: { to: string; text: string }; idempotencyKey: string };
    expect(call.idempotencyKey).toMatch(new RegExp('^manage_link/' + UUID + '/' + UUID + '$'));
    expect(call.payload.to).toBe('ann@example.test');
    expect(call.payload.text).toContain('https://calvin.test/m/' + token);
  });

  it('still redirects, shows the failure copy and logs without the address when the send fails (AC3)', async () => {
    const lines = captureLogs();
    const deps = testDeps();
    deps.fakes.email.failNext();

    const res = await post(deps);

    expect(res.status).toBe(303);
    const location = res.headers.get('location') ?? '';
    expect(location).toMatch(/^\/m\/[A-Za-z0-9_-]{43}\/published$/);
    const page = await createApp(deps, { baseUrl: TEST_BASE_URL }).request(location);
    expect(await page.text()).toContain(
      "We couldn't email you your private link. Bookmark the link below to manage the plan.",
    );
    const plan = await publishedPlan(res);
    const errors = lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.level === 'error');
    expect(errors).toHaveLength(1);
    expect(JSON.stringify(errors[0])).toContain(plan!.id);
    expect(lines.join('')).not.toContain('ann@example.test');
  });

  it('never logs the address from a provider error message', async () => {
    const lines = captureLogs();
    const deps = testDeps({
      sendEmail: async () => {
        throw new Error('bounce for ann@example.test');
      },
    });

    const res = await post(deps);

    expect(res.status).toBe(303);
    expect(lines.join('')).not.toContain('ann@example.test');
    expect(lines.join('')).not.toContain('bounce');
  });

  it('still redirects when the send fails permanently', async () => {
    captureLogs();
    const deps = testDeps({
      sendEmail: async () => {
        throw ApplicationFailure.nonRetryable('bad');
      },
    });

    const res = await post(deps);

    expect(res.status).toBe(303);
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

async function postSuggest(
  deps: ReturnType<typeof testDeps>,
  fields: Record<string, string> = {},
  headers: Record<string, string> = {},
  app = createApp(deps, { baseUrl: TEST_BASE_URL }),
) {
  return app.request('/suggest', {
    method: 'POST',
    headers: { ...sameOrigin, ...headers },
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

  it('stores a failed invalid_proposal row for an over-long venue and shows the fallback', async () => {
    const response = loadFixture('good');
    const call = response.content.find((block) => block.name === 'propose_plan')!;
    (call.input as Record<string, unknown>).venue = 'v'.repeat(121);
    const fake = fakeSuggest(response);
    const deps = testDeps({ suggestPlanCall: fake.call });

    const res = await postSuggest(deps);

    expect(res.status).toBe(303);
    const location = res.headers.get('location') ?? '';
    const stored = await loadSuggestion(db, location.split('=')[1] ?? '');
    expect(stored).toMatchObject({ outcome: 'failed', failureReason: 'invalid_proposal' });
    const page = await createApp(deps, { baseUrl: TEST_BASE_URL }).request(location);
    expect(await page.text()).toContain('Fill in your own below');
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

async function suggestedLocation(deps: ReturnType<typeof testDeps>): Promise<string> {
  const res = await postSuggest(deps);
  return res.headers.get('location') ?? '';
}

function inputTag(body: string, name: string): string {
  return body.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? '';
}

const cardForm = {
  format: 'coffee',
  venue: 'Highwire Coffee Roasters',
  date: '2026-11-14',
  time: '10:00',
  minimum: '3',
  deadlineDate: '2026-11-11',
  deadlineTime: '22:00',
};

describe('POST /plans from a suggestion', () => {
  it('publishes the card unchanged (AC8)', async () => {
    const deps = testDeps({ suggestPlanCall: fakeSuggest(loadFixture('good')).call });
    const suggestionId = (await suggestedLocation(deps)).split('=')[1] ?? '';

    const res = await post(deps, { ...cardForm, suggestionId });

    expect(res.status).toBe(303);
    const plan = await publishedPlan(res);
    expect(plan?.suggestionId).toBe(suggestionId);
    expect(plan?.suggestionEdited).toBe(false);
  });

  it('a changed venue is edited (AC9)', async () => {
    const deps = testDeps({ suggestPlanCall: fakeSuggest(loadFixture('good')).call });
    const suggestionId = (await suggestedLocation(deps)).split('=')[1] ?? '';

    const res = await post(deps, { ...cardForm, venue: 'Peet’s Coffee', suggestionId });

    expect(res.status).toBe(303);
    expect((await publishedPlan(res))?.suggestionEdited).toBe(true);
  });

  it('changing When and leaving Decide by takes the default deadline, and does not fail the deadline check (AC10)', async () => {
    const deps = testDeps({ suggestPlanCall: fakeSuggest(loadFixture('good')).call });
    const suggestionId = (await suggestedLocation(deps)).split('=')[1] ?? '';

    const res = await post(deps, { ...cardForm, date: '2026-11-11', time: '09:00', suggestionId });

    expect(res.status).toBe(303);
    const plan = await publishedPlan(res);
    expect(plan?.commitDeadlineAt).toBe('2026-11-10T17:30:00Z');
    expect(plan?.suggestionEdited).toBe(true);
  });

  it('does not report the stale deadline when another field fails (AC10)', async () => {
    const deps = testDeps({ suggestPlanCall: fakeSuggest(loadFixture('good')).call });
    const suggestionId = (await suggestedLocation(deps)).split('=')[1] ?? '';

    const res = await post(deps, { ...cardForm, date: '2026-11-11', time: '09:00', venue: '', suggestionId });

    expect(res.status).toBe(422);
    const body = await res.text();
    expect(body).toContain('Add where it is.');
    expect(body).not.toContain('The decide-by time needs to be before the gathering.');
  });

  it('a plan from the fallback form has no suggestion_id (AC11)', async () => {
    const deps = testDeps({ suggestPlanCall: fakeSuggest(loadFixture('no-tool-call')).call });
    await suggestedLocation(deps);

    const res = await post(deps);

    expect(res.status).toBe(303);
    const plan = await publishedPlan(res);
    expect(plan?.suggestionId).toBeNull();
    expect(plan?.suggestionEdited).toBeNull();
  });

  it('treats a failed, unknown or malformed suggestionId as absent', async () => {
    const failedDeps = testDeps({ suggestPlanCall: fakeSuggest(loadFixture('refusal')).call });
    const failedId = (await suggestedLocation(failedDeps)).split('=')[1] ?? '';
    const ids = [failedId, '00000000-0000-4000-8000-000000000000', 'nope'];

    for (const suggestionId of ids) {
      const res = await post(testDeps(), { suggestionId });

      expect(res.status).toBe(303);
      const plan = await publishedPlan(res);
      expect(plan?.suggestionId).toBeNull();
      expect(plan?.suggestionEdited).toBeNull();
    }
  });
});

describe('GET /', () => {
  it('renders the inputs state linking the stylesheet', async () => {
    const app = createApp(testDeps(), { baseUrl: TEST_BASE_URL });

    const res = await app.request('/');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('/static/app.css');
    expect(body).toContain('Suggest a plan</button>');
    expect(body).not.toContain('Publish plan');
  });

  it('shows the summary, the card rows and the publish form (AC1)', async () => {
    const fake = fakeSuggest(loadFixture('good'));
    const deps = testDeps({ suggestPlanCall: fake.call });
    const location = await suggestedLocation(deps);

    const res = await createApp(deps, { baseUrl: TEST_BASE_URL }).request(location);

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Oakland · Rockridge · next weekend, morning');
    expect(inputTag(body, 'format')).toContain('value="coffee"');
    expect(inputTag(body, 'venue')).toContain('value="Highwire Coffee Roasters"');
    expect(inputTag(body, 'date')).toContain('value="2026-11-14"');
    expect(inputTag(body, 'time')).toContain('value="10:00"');
    expect(inputTag(body, 'minimum')).toContain('value="3"');
    expect(inputTag(body, 'deadlineDate')).toContain('value="2026-11-11"');
    expect(inputTag(body, 'deadlineTime')).toContain('value="22:00"');
    expect(inputTag(body, 'suggestionId')).toContain('type="hidden"');
    expect(inputTag(body, 'suggestionId')).toContain(`value="${location.split('=')[1]}"`);
    expect(inputTag(body, 'name')).not.toBe('');
    expect(inputTag(body, 'email')).not.toBe('');
    expect(body).toContain('Publish plan');
  });

  it.each([['no-tool-call'], ['pause-turn'], ['refusal'], ['max-tokens']] as const)(
    'shows the fallback for a failed suggestion, %s (AC3)',
    async (name) => {
      const deps = testDeps({ suggestPlanCall: fakeSuggest(loadFixture(name)).call });
      const location = await suggestedLocation(deps);

      const res = await createApp(deps, { baseUrl: TEST_BASE_URL }).request(location);

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain(
        'We couldn&#39;t come up with a suggestion just now. Fill in your own below, or try again.',
      );
      expect(body).toContain('Oakland · Rockridge · next weekend, morning');
      for (const field of ['format', 'venue', 'date', 'time', 'deadlineDate', 'deadlineTime']) {
        expect(inputTag(body, field)).toContain('value=""');
      }
      expect(inputTag(body, 'minimum')).toContain('value="3"');
      expect(body).not.toContain('name="suggestionId"');
      expect(body).toContain('Publish plan');
    },
  );

  it('does not call Claude again when the page is requested twice (AC6)', async () => {
    const fake = fakeSuggest(loadFixture('good'));
    const deps = testDeps({ suggestPlanCall: fake.call });
    const location = await suggestedLocation(deps);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    await app.request(location);
    await app.request(location);

    expect(fake.calls).toHaveLength(1);
  });

  it.each([[''], ['nope'], ['00000000-0000-4000-8000-000000000000']])(
    'answers 200 with the plain inputs state for ?suggestion=%s (AC7)',
    async (value) => {
      const app = createApp(testDeps(), { baseUrl: TEST_BASE_URL });

      const res = await app.request(`/?suggestion=${value}`);

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('Suggest a plan</button>');
      expect(body).not.toContain('Publish plan');
      expect(body).not.toContain('name="venue"');
    },
  );

  it('escapes HTML in the venue', async () => {
    const good = loadFixture('good');
    const edited = {
      ...good,
      content: good.content.map((block) =>
        block.name === 'propose_plan'
          ? { ...block, input: { ...(block.input as object), venue: '<script>x</script>' } }
          : block,
      ),
    };
    const deps = testDeps({ suggestPlanCall: fakeSuggest(edited).call });
    const location = await suggestedLocation(deps);

    const res = await createApp(deps, { baseUrl: TEST_BASE_URL }).request(location);

    const body = await res.text();
    expect(body).toContain('&lt;script&gt;');
    expect(body).not.toContain('<script>x');
  });

  it('still renders a card whose gathering is now in the past', async () => {
    const fake = fakeSuggest(loadFixture('good'));
    const location = await suggestedLocation(testDeps({ suggestPlanCall: fake.call }));
    const later = testDeps({ now: fixedClock('2026-11-20T18:00:00Z'), suggestPlanCall: fake.call });

    const res = await createApp(later, { baseUrl: TEST_BASE_URL }).request(location);

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(inputTag(body, 'venue')).toContain('value="Highwire Coffee Roasters"');
    expect(inputTag(body, 'date')).toContain('value="2026-11-14"');
  });
});

describe('POST /plans re-render state', () => {
  it('keeps the card, with its suggestionId, when a card publish fails', async () => {
    const deps = testDeps({ suggestPlanCall: fakeSuggest(loadFixture('good')).call });
    const id = (await suggestedLocation(deps)).split('=')[1] ?? '';

    const res = await post(deps, { suggestionId: id, name: '' });

    expect(res.status).toBe(422);
    const body = await res.text();
    expect(body).toContain('Add your name.');
    expect(inputTag(body, 'suggestionId')).toContain(`value="${id}"`);
  });

  it('shows the fallback form when a publish fails without a suggestion', async () => {
    const res = await post(testDeps(), { name: '' });

    expect(res.status).toBe(422);
    const body = await res.text();
    expect(body).toContain('Oakland · Rockridge · next weekend');
    expect(body).not.toContain('name="suggestionId"');
    expect(inputTag(body, 'venue')).toContain('value="Blue Bottle"');
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

describe('POST /suggest rate limit', () => {
  const fromIp = (ip: string) => ({ 'Fly-Client-IP': ip });

  it('answers 429 on the 11th suggestion from one IP (AC1)', async () => {
    const deps = testDeps();
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });
    for (let i = 0; i < 10; i++) {
      expect((await postSuggest(deps, {}, fromIp('203.0.113.7'), app)).status).toBe(303);
    }

    const res = await postSuggest(deps, {}, fromIp('203.0.113.7'), app);

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/);
    const body = await res.text();
    expect(body).toContain(SUGGEST_LIMIT_NOTICE);
    expect(body).toContain('action="/plans"');
    expect(body).toContain('value="Oakland"');
    expect(body).toContain('value="Rockridge"');
    expect(body).toContain('value="next weekend, morning"');
    expect(body).not.toContain('name="suggestionId"');
    expect(deps.fakes.suggest.calls).toHaveLength(10);
    expect(await countSuggestions(db)).toBe(10);
  });

  it('answers 429 on the 201st suggestion of a Los Angeles day (AC2)', async () => {
    const deps = testDeps({ now: fixedClock('2026-11-09T18:00:00Z') });
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });
    for (let i = 0; i < 200; i++) {
      expect((await postSuggest(deps, {}, fromIp(`198.51.100.${i}`), app)).status).toBe(303);
    }

    const res = await postSuggest(deps, {}, fromIp('192.0.2.1'), app);

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/);
  });

  it('does not limit another IP (AC5)', async () => {
    const deps = testDeps();
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });
    for (let i = 0; i < 10; i++) await postSuggest(deps, {}, fromIp('203.0.113.7'), app);
    expect((await postSuggest(deps, {}, fromIp('203.0.113.7'), app)).status).toBe(429);

    const res = await postSuggest(deps, {}, fromIp('203.0.113.8'), app);

    expect(res.status).toBe(303);
  });

  it('counts invalid suggestions (AC6)', async () => {
    const deps = testDeps();
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });
    for (let i = 0; i < 10; i++) {
      expect((await postSuggest(deps, { city: '' }, fromIp('203.0.113.7'), app)).status).toBe(422);
    }

    const res = await postSuggest(deps, {}, fromIp('203.0.113.7'), app);

    expect(res.status).toBe(429);
    expect(deps.fakes.suggest.calls).toHaveLength(0);
  });

  it('shares one key without Fly-Client-IP', async () => {
    const deps = testDeps();
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });
    for (let i = 0; i < 5; i++) expect((await postSuggest(deps, {}, {}, app)).status).toBe(303);
    for (let i = 0; i < 5; i++) expect((await postSuggest(deps, {}, { 'Fly-Client-IP': '' }, app)).status).toBe(303);

    const res = await postSuggest(deps, {}, {}, app);

    expect(res.status).toBe(429);
  });

  it('escapes what was entered on the 429 page', async () => {
    const deps = testDeps();
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });
    for (let i = 0; i < 10; i++) await postSuggest(deps, {}, fromIp('203.0.113.7'), app);

    const res = await postSuggest(deps, { area: '<script>x</script>' }, fromIp('203.0.113.7'), app);

    expect(res.status).toBe(429);
    const body = await res.text();
    expect(body).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(body).not.toContain('<script>x');
  });
});

describe('POST /plans rate limit', () => {
  const fromIp = (ip: string) => ({ 'Fly-Client-IP': ip });
  let seq = 0;
  async function postPlan(app: ReturnType<typeof createApp>, ip: string, overrides: Record<string, string> = {}) {
    seq += 1;
    return app.request('/plans', {
      method: 'POST',
      headers: { ...sameOrigin, ...fromIp(ip) },
      body: new URLSearchParams(planForm({ email: `ann${seq}@example.test`, ...overrides })),
    });
  }

  it('answers 429 on the 4th publish from one IP (AC3)', async () => {
    const deps = testDeps();
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });
    for (let i = 0; i < 3; i++) expect((await postPlan(app, '203.0.113.7')).status).toBe(303);

    const res = await postPlan(app, '203.0.113.7', { venue: 'Chez Panisse' });

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/);
    const body = await res.text();
    expect(body).toContain(PUBLISH_LIMIT_NOTICE);
    expect(body).toContain('Chez Panisse');
    expect(body).toContain('value="Oakland"');
    expect(body).toContain('value="Rockridge"');
    expect(await countPlans(db)).toBe(3);
  });

  it('answers 429 on the 51st publish of a Los Angeles day (AC4)', async () => {
    const deps = testDeps({ now: fixedClock('2026-11-09T18:00:00Z') });
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });
    for (let i = 0; i < 50; i++) {
      expect((await postPlan(app, `198.51.100.${i}`, { date: '2026-11-20' })).status).toBe(303);
    }

    const res = await postPlan(app, '192.0.2.1', { date: '2026-11-20' });

    expect(res.status).toBe(429);
    expect(await countPlans(db)).toBe(50);
  });

  it('does not limit another IP (AC5)', async () => {
    const app = createApp(testDeps(), { baseUrl: TEST_BASE_URL });
    for (let i = 0; i < 3; i++) await postPlan(app, '203.0.113.7');
    expect((await postPlan(app, '203.0.113.7')).status).toBe(429);

    const res = await postPlan(app, '203.0.113.8');

    expect(res.status).toBe(303);
  });

  it('counts invalid publishes (AC6)', async () => {
    const app = createApp(testDeps(), { baseUrl: TEST_BASE_URL });
    for (let i = 0; i < 3; i++) expect((await postPlan(app, '203.0.113.7', { venue: '' })).status).toBe(422);

    const res = await postPlan(app, '203.0.113.7');

    expect(res.status).toBe(429);
    expect(await countPlans(db)).toBe(0);
  });

  it('keeps the suggestion card on the 429 page', async () => {
    const deps = testDeps({ suggestPlanCall: fakeSuggest(loadFixture('good')).call });
    const id = (await suggestedLocation(deps)).split('=')[1] ?? '';
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });
    for (let i = 0; i < 3; i++) await postPlan(app, '203.0.113.7');

    const res = await postPlan(app, '203.0.113.7', { suggestionId: id });

    expect(res.status).toBe(429);
    const body = await res.text();
    expect(body).toContain(PUBLISH_LIMIT_NOTICE);
    expect(inputTag(body, 'suggestionId')).toContain(`value="${id}"`);
  });
});

describe('rate limited requests log', () => {
  const IP = '203.0.113.7';
  let written: string[];
  beforeEach(() => {
    written = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const logLines = () =>
    written
      .join('')
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as Record<string, unknown>];
        } catch {
          return [];
        }
      });

  function expectOneWarnWithoutIp(route: string) {
    const limited = logLines().filter((l) => l.msg === 'rate limited');
    expect(limited).toHaveLength(1);
    expect(limited[0]).toMatchObject({ level: 'warn', route });
    const requests = logLines().filter((l) => l.msg === 'request');
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.at(-1)).toMatchObject({ status: 429 });
    expect(written.join('')).not.toContain(IP);
  }

  it('logs a limited suggest request at warn without the IP (AC7)', async () => {
    const deps = testDeps();
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });
    for (let i = 0; i < 10; i++) await postSuggest(deps, {}, { 'Fly-Client-IP': IP }, app);

    const res = await postSuggest(deps, {}, { 'Fly-Client-IP': IP }, app);

    expect(res.status).toBe(429);
    expectOneWarnWithoutIp('suggest');
  });

  it('logs a limited publish request at warn without the IP (AC7)', async () => {
    const app = createApp(testDeps(), { baseUrl: TEST_BASE_URL });
    const post = (n: number) =>
      app.request('/plans', {
        method: 'POST',
        headers: { ...sameOrigin, 'Fly-Client-IP': IP },
        body: new URLSearchParams(planForm({ email: `log${n}@example.test` })),
      });
    for (let i = 0; i < 3; i++) await post(i);

    const res = await post(3);

    expect(res.status).toBe(429);
    expectOneWarnWithoutIp('publish');
  });
});
