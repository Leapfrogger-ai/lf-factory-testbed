import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishPlan, sameOrigin, testDeps, TEST_BASE_URL } from '../../../tests/support/builders.ts';
import { resetDb, testDb } from '../../../tests/support/db.ts';
import { fakePlanWorkflows, fixedClock } from '../../../tests/support/fakes.ts';
import { commit, loadPlan } from '../../domain/plans.ts';
import { newToken } from '../../domain/tokens.ts';
import { createApp } from '../app.ts';
import { commitFormSchema } from '../forms.ts';

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

function post(app: ReturnType<typeof createApp>, token: string, body: Record<string, string>) {
  return app.request(`/p/${token}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...sameOrigin },
    body: new URLSearchParams(body).toString(),
  });
}

const creator = { name: 'Ana Ruiz', email: 'ana@example.test' };

// The example plan (minimum 3) with Ana and Raj in, so one more commit confirms it.
async function confirmedPlan(deps: ReturnType<typeof testDeps>) {
  const published = await publishPlan(deps, creator);
  await commit(deps, published.publicToken, commitFormSchema.parse({ name: 'Raj Rao', email: 'raj@example.test' }));
  return published;
}

describe('GET /p/:token', () => {
  it('shows the open plan (AC1)', async () => {
    const deps = testDeps();
    const { publicToken } = await publishPlan(deps, creator);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    const res = await app.request(`/p/${publicToken}`);

    expect(res.status).toBe(200);
    const body = decodeEntities(await res.text());
    expect(body).toContain('Needs 2 more');
    expect(body).toContain('<h1 class="venue">Blue Bottle</h1>');
    expect(body).toContain('<p class="when">Sat 14 Nov · 10:00 AM</p>');
    expect(body).toContain('<p class="where">Oakland</p>');
    expect(body).toContain('Ana');
    expect(body).not.toContain('Ruiz');
    expect(body).toContain('you?');
    expect(body).toContain('aria-label="1 of 3 people in"');
    expect(body).toContain('Goes ahead with a minimum of 3. Decide by Wed 11 Nov, 10:00 PM.');
    expect(body).toContain('name="email"');
    expect(body).not.toContain('<script');
    expect(body.match(/<link rel="stylesheet"/g)).toHaveLength(1);
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

describe('POST /p/:token/commit', () => {
  it("Mia's commit redirects to notice=in and the page shows it", async () => {
    const deps = testDeps();
    const { publicToken } = await publishPlan(deps, creator);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    const res = await post(app, publicToken, { name: 'Mia Chen', email: 'mia@example.test' });

    expect(res.status).toBe(303);
    const location = res.headers.get('location')!;
    expect(location).toBe(`/p/${publicToken}?notice=in&n=Mia`);
    const body = decodeEntities(await (await app.request(location)).text());
    expect(body).toContain("You're in, Mia. We'll email you if it's on.");
    expect(body).toContain('Ana');
    expect(body).toContain('Mia');
    expect(body.match(/you\?/g)).toHaveLength(1);
    expect(body).toContain('Needs 1 more');
    expect(body).not.toContain('name="email"');
  });

  it('a repeat commit with other case and name redirects with notice=updated', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps, creator);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });
    await post(app, publicToken, { name: 'Mia Chen', email: 'mia@example.test' });

    const res = await post(app, publicToken, { name: 'Mimi Chen', email: 'MIA@Example.test' });

    expect(res.status).toBe(303);
    const location = res.headers.get('location')!;
    expect(location).toBe(`/p/${publicToken}?notice=updated&n=Mimi`);
    const body = decodeEntities(await (await app.request(location)).text());
    expect(body).toContain("Updated: you're in as Mimi.");
    expect((await loadPlan(deps.db, manageToken))!.count).toBe(2);
  });

  it('the events record new and repeat with the active count', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps, creator);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });
    await post(app, publicToken, { name: 'Mia Chen', email: 'mia@example.test' });
    await post(app, publicToken, { name: 'Mimi Chen', email: 'MIA@Example.test' });

    // The creator's own commit.added from publishing comes first; Mia's are the ones that are not the creator's.
    const added = (await loadPlan(deps.db, manageToken))!.events.filter(
      (e) => e.type === 'commit.added' && e.data.isCreator === false,
    );

    expect(added.map((e) => e.data)).toEqual([
      { change: 'new', isCreator: false, activeCount: 2 },
      { change: 'repeat', isCreator: false, activeCount: 2 },
    ]);
  });

  it.each([
    {
      label: 'an empty name',
      entered: { name: '', email: 'mia@example.test' },
      message: 'Add your name.',
      id: 'name-error',
      kept: 'value="mia@example.test"',
    },
    {
      label: 'the email "mia@"',
      entered: { name: 'Mia Chen', email: 'mia@' },
      message: "That email doesn't look right.",
      id: 'email-error',
      kept: 'value="Mia Chen"',
    },
  ])('$label re-renders with 422 and keeps what was entered', async ({ entered, message, id, kept }) => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps, creator);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    const res = await post(app, publicToken, entered);

    expect(res.status).toBe(422);
    const body = decodeEntities(await res.text());
    expect(body).toContain('<h1 class="venue">Blue Bottle</h1>');
    expect(body).toContain(message);
    expect(body).toContain(`id="${id}"`);
    expect(body).toContain(kept);
    expect((await loadPlan(deps.db, manageToken))!.count).toBe(1);
  });

  it('a commit after the commit deadline is refused', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps, creator);
    const app = createApp({ ...deps, now: fixedClock('2026-11-12T06:00:00Z') }, { baseUrl: TEST_BASE_URL });
    const before = (await loadPlan(deps.db, manageToken))!.events.length;

    const res = await post(app, publicToken, { name: 'Mia Chen', email: 'mia@example.test' });

    expect(res.status).toBe(303);
    const location = res.headers.get('location')!;
    expect(location).toBe(`/p/${publicToken}?notice=closed`);
    expect(decodeEntities(await (await app.request(location)).text())).toContain(
      "This one isn't taking commits any more.",
    );
    const plan = (await loadPlan(deps.db, manageToken))!;
    expect(plan.count).toBe(1);
    expect(plan.events).toHaveLength(before);
  });

  it('a commit once the gathering has started is refused', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await publishPlan(deps, creator);
    const app = createApp({ ...deps, now: fixedClock('2026-11-14T18:00:00Z') }, { baseUrl: TEST_BASE_URL });
    const before = (await loadPlan(deps.db, manageToken))!.events.length;

    const res = await post(app, publicToken, { name: 'Mia Chen', email: 'mia@example.test' });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/p/${publicToken}?notice=closed`);
    const plan = (await loadPlan(deps.db, manageToken))!;
    expect(plan.count).toBe(1);
    expect(plan.events).toHaveLength(before);
  });

  it('GET /p/:token/commit is the 404 page', async () => {
    const deps = testDeps();
    const { publicToken } = await publishPlan(deps, creator);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    const res = await app.request(`/p/${publicToken}/commit`);

    expect(res.status).toBe(404);
    expect(decodeEntities(await res.text())).toContain(NOT_FOUND_COPY);
  });

  it('a malformed token POST is 404 and never touches the database', async () => {
    const throwingDb = new Proxy(
      {},
      {
        get() {
          throw new Error('database touched');
        },
      },
    ) as ReturnType<typeof testDeps>['db'];
    const app = createApp(testDeps({ db: throwingDb }), { baseUrl: TEST_BASE_URL });

    for (const token of ['short', 'a'.repeat(44), `${'a'.repeat(42)}.`]) {
      const res = await post(app, token, { name: 'Mia Chen', email: 'mia@example.test' });
      expect(res.status, token).toBe(404);
      expect(decodeEntities(await res.text()), token).toContain(NOT_FOUND_COPY);
    }
    // An invalid form on a malformed token is the 404 page too, not a 422.
    expect((await post(app, 'short', { name: '', email: 'mia@' })).status).toBe(404);
  });

  it('an unknown token POST is 404', async () => {
    const app = createApp(testDeps(), { baseUrl: TEST_BASE_URL });

    const valid = await post(app, newToken(), { name: 'Mia Chen', email: 'mia@example.test' });
    const invalid = await post(app, newToken(), { name: '', email: 'mia@' });

    expect(valid.status).toBe(404);
    expect(decodeEntities(await valid.text())).toContain(NOT_FOUND_COPY);
    expect(invalid.status).toBe(404);
  });

  it('an unknown notice and an n over 16 characters on GET /p/:token', async () => {
    const deps = testDeps();
    const { publicToken } = await publishPlan(deps, creator);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    const bogus = decodeEntities(await (await app.request(`/p/${publicToken}?notice=bogus&n=Mia`)).text());
    const long = decodeEntities(
      await (await app.request(`/p/${publicToken}?notice=in&n=${'a'.repeat(40)}`)).text(),
    );
    const bare = decodeEntities(await (await app.request(`/p/${publicToken}?notice=in`)).text());

    expect(bogus).not.toContain('role="status"');
    expect(bogus).toContain('name="email"');
    expect(long).toContain(`You're in, ${'a'.repeat(16)}. We'll email you if it's on.`);
    expect(long).not.toContain('a'.repeat(17));
    expect(bare).toContain("You're in. We'll email you if it's on.");
    expect(bare).not.toContain('undefined');
  });

  it('a name with markup commits and the notice escapes it', async () => {
    const deps = testDeps();
    const { publicToken } = await publishPlan(deps, creator);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    const res = await post(app, publicToken, { name: '<b>Mia</b> Chen', email: 'mia@example.test' });

    const location = res.headers.get('location')!;
    expect(res.status).toBe(303);
    expect(location).not.toContain('<b>');
    const raw = await (await app.request(location)).text();
    expect(raw).not.toContain('<b>');
    expect(raw).toContain('You&#39;re in, &lt;b&gt;Mia&lt;/b&gt;.');
  });

  it("Mia's commit confirms the example plan and signals once", async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await confirmedPlan(deps);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    const res = await post(app, publicToken, { name: 'Mia Chen', email: 'mia@example.test' });

    expect(res.status).toBe(303);
    const location = res.headers.get('location')!;
    expect(location).toBe(`/p/${publicToken}?notice=on&n=Mia`);
    const body = decodeEntities(await (await app.request(location)).text());
    expect(body).toContain(
      "You're in, Mia. It's on! We've emailed you the details and we'll remind you the day before.",
    );
    expect(body).toContain("It's on");
    expect(body).not.toContain('name="email"');
    const plan = (await loadPlan(deps.db, manageToken))!;
    expect(plan.state).toBe('confirmed');
    expect(plan.events.some((e) => e.type === 'plan.confirmed')).toBe(true);
    expect(deps.fakes.planWorkflows.signalCalls).toEqual([{ planId: plan.id, signal: 'confirmed', arg: undefined }]);
  });

  it("a confirmed plan's page shows It's on, every seat filled, the welcome line, the form and the og suffix", async () => {
    const deps = testDeps();
    const { publicToken } = await confirmedPlan(deps);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });
    await post(app, publicToken, { name: 'Mia Chen', email: 'mia@example.test' });

    const body = decodeEntities(await (await app.request(`/p/${publicToken}`)).text());

    expect(body).toContain("It's on");
    expect(body).toContain('More people are welcome until it starts.');
    expect(body).toContain('name="email"');
    expect(body).not.toContain('you?');
    expect(body.match(/<li class="seat"/g)).toHaveLength(3);
    expect(body).toMatch(/<meta property="og:description" content="[^"]* It's on\."/);
  });

  it("a new commit on a confirmed plan after its deadline signals committed with the new commit's id", async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await confirmedPlan(deps);
    await post(createApp(deps, { baseUrl: TEST_BASE_URL }), publicToken, { name: 'Mia Chen', email: 'mia@example.test' });
    const late = createApp({ ...deps, now: fixedClock('2026-11-13T18:00:00Z') }, { baseUrl: TEST_BASE_URL });

    const res = await post(late, publicToken, { name: 'Sam Lee', email: 'sam@example.test' });
    const other = await post(late, publicToken, { name: 'Kit Wu', email: 'kit@example.test' });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/p/${publicToken}?notice=on&n=Sam`);
    expect(other.headers.get('location')).toBe(`/p/${publicToken}?notice=on&n=Kit`);
    expect((await loadPlan(deps.db, manageToken))!.count).toBe(5);
    const calls = deps.fakes.planWorkflows.signalCalls;
    expect(calls.map((c) => c.signal)).toEqual(['confirmed', 'committed', 'committed']);
    const [, sam, kit] = calls;
    expect(typeof sam!.arg).toBe('string');
    expect(typeof kit!.arg).toBe('string');
    expect(sam!.arg).not.toBe(kit!.arg);
  });

  it('an existing committer committing again sends no signal and shows updated', async () => {
    const deps = testDeps();
    const { publicToken } = await confirmedPlan(deps);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });
    await post(app, publicToken, { name: 'Mia Chen', email: 'mia@example.test' });

    const res = await post(app, publicToken, { name: 'Mia Chen', email: 'MIA@Example.test' });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/p/${publicToken}?notice=updated&n=Mia`);
    expect(deps.fakes.planWorkflows.signalCalls.map((c) => c.signal)).toEqual(['confirmed']);
  });

  it('two simultaneous commits on a plan one short send one confirmed signal', async () => {
    const deps = testDeps();
    const { publicToken, manageToken } = await confirmedPlan(deps);
    const app = createApp(deps, { baseUrl: TEST_BASE_URL });

    const [mia, sam] = await Promise.all([
      post(app, publicToken, { name: 'Mia Chen', email: 'mia@example.test' }),
      post(app, publicToken, { name: 'Sam Lee', email: 'sam@example.test' }),
    ]);

    expect(mia.status).toBe(303);
    expect(sam.status).toBe(303);
    expect(deps.fakes.planWorkflows.signalCalls.map((c) => c.signal).sort()).toEqual(['committed', 'confirmed']);
    const plan = (await loadPlan(deps.db, manageToken))!;
    expect(plan.events.filter((e) => e.type === 'plan.confirmed')).toHaveLength(1);
  });

  it.each([
    { now: '2026-11-14T20:59:59Z', copy: 'Happening now' },
    { now: '2026-11-14T21:00:00Z', copy: 'This was on Sat 14 Nov' },
  ])('a confirmed plan at $now reads "$copy" with no form', async ({ now, copy }) => {
    const deps = testDeps();
    const { publicToken } = await confirmedPlan(deps);
    await post(createApp(deps, { baseUrl: TEST_BASE_URL }), publicToken, { name: 'Mia Chen', email: 'mia@example.test' });
    const app = createApp({ ...deps, now: fixedClock(now) }, { baseUrl: TEST_BASE_URL });

    const body = decodeEntities(await (await app.request(`/p/${publicToken}`)).text());

    expect(body).toContain(copy);
    expect(body).not.toContain('name="email"');
    expect(body).toContain('<li class="seat"');
  });

  it('a POST once the gathering has started on a confirmed plan is refused with notice=closed and no signal', async () => {
    const deps = testDeps();
    const { publicToken } = await confirmedPlan(deps);
    await post(createApp(deps, { baseUrl: TEST_BASE_URL }), publicToken, { name: 'Mia Chen', email: 'mia@example.test' });
    const app = createApp({ ...deps, now: fixedClock('2026-11-14T18:00:00Z') }, { baseUrl: TEST_BASE_URL });

    const res = await post(app, publicToken, { name: 'Sam Lee', email: 'sam@example.test' });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/p/${publicToken}?notice=closed`);
    expect(deps.fakes.planWorkflows.signalCalls.map((c) => c.signal)).toEqual(['confirmed']);
  });

  describe('logging', () => {
    afterEach(() => vi.restoreAllMocks());

    function captureLog() {
      const lines: Record<string, unknown>[] = [];
      vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
        for (const l of String(chunk).split('\n').filter(Boolean)) {
          try {
            lines.push(JSON.parse(l));
          } catch {
            // not a log line
          }
        }
        return true;
      }) as typeof process.stdout.write);
      return lines;
    }

    it('a failing signal leaves the plan confirmed, the response a 303 and an error log line', async () => {
      const lines = captureLog();
      const deps = testDeps({
        planWorkflows: {
          ...fakePlanWorkflows(),
          signal: async () => {
            throw new Error('temporal down');
          },
        },
      });
      const { publicToken, manageToken } = await confirmedPlan(deps);
      const app = createApp(deps, { baseUrl: TEST_BASE_URL });

      const res = await post(app, publicToken, { name: 'Mia Chen', email: 'mia@example.test' });
      const location = res.headers.get('location')!;
      const body = await (await app.request(location)).text();

      expect(res.status).toBe(303);
      expect(location).toBe(`/p/${publicToken}?notice=on&n=Mia`);
      const plan = (await loadPlan(deps.db, manageToken))!;
      expect(plan.state).toBe('confirmed');
      const errorLine = lines.find((l) => l.level === 'error' && l.msg === 'plan signal failed');
      expect(errorLine).toMatchObject({ planId: plan.id, signal: 'confirmed' });
      const logged = JSON.stringify(lines).toLowerCase();
      for (const secret of ['mia@example.test', publicToken.toLowerCase(), 'temporal down']) {
        expect(logged).not.toContain(secret);
        expect(location.toLowerCase().replace(publicToken.toLowerCase(), '')).not.toContain(secret);
        expect(body.toLowerCase().replaceAll(publicToken.toLowerCase(), '')).not.toContain(secret);
      }
    });

    it('no email address in the redirect, the page or the log', async () => {
      const lines = captureLog();
      const deps = testDeps();
      const { publicToken } = await publishPlan(deps, creator);
      const app = createApp(deps, { baseUrl: TEST_BASE_URL });

      const res = await post(app, publicToken, { name: 'Mia Chen', email: 'mia@example.test' });
      const location = res.headers.get('location')!;
      const body = await (await app.request(location)).text();

      const logged = JSON.stringify(lines).toLowerCase();
      expect(location.toLowerCase()).not.toContain('example.test');
      expect(body.toLowerCase()).not.toContain('example.test');
      expect(logged).not.toContain('mia@example.test');
      expect(logged).not.toContain('example.test');
      expect(logged).not.toContain(publicToken.toLowerCase());
      const commitLine = lines.find((l) => l.msg === 'request' && l.status === 303);
      expect(commitLine?.path).toBe('/p/:token/commit');
    });
  });
});
