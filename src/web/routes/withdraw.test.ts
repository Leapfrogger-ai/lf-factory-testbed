import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { publishPlan, sameOrigin, testDeps, TEST_BASE_URL } from '../../../tests/support/builders.ts';
import { resetDb, testDb } from '../../../tests/support/db.ts';
import { fixedClock } from '../../../tests/support/fakes.ts';
import { callOff, loadPlan, resolveDeadline } from '../../domain/plans.ts';
import { newToken } from '../../domain/tokens.ts';
import { createApp } from '../app.ts';

const { db, pool } = testDb();

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const NOT_FOUND_COPY = "We can't find that plan. The link may be incomplete. Check it in your chat or email.";
const CONFIRM_HEADING = 'Withdraw from Coffee at Blue Bottle on Sat 14 Nov?';

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

function postWithdraw(app: ReturnType<typeof createApp>, token: string) {
  return app.request(`/w/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: TEST_BASE_URL, ...sameOrigin },
    body: '',
  });
}

function postCommit(app: ReturnType<typeof createApp>, publicToken: string, name: string, email: string) {
  return app.request(`/p/${publicToken}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: TEST_BASE_URL, ...sameOrigin },
    body: new URLSearchParams({ name, email }).toString(),
  });
}

const creator = { name: 'Ana Ruiz', email: 'ana@example.test' };

// The example plan with Ana the creator and Mia committed; returns Mia's withdraw token.
async function pageWith(minimum = '4', extra: { name: string; email: string }[] = []) {
  const deps = testDeps();
  const published = await publishPlan(deps, { ...creator, minimum });
  const app = createApp(deps, { baseUrl: TEST_BASE_URL });
  // Through the route, so the plan workflow receives the signals a real commit sends.
  for (const who of [...extra, { name: 'Mia Chen', email: 'mia@example.test' }]) {
    await postCommit(app, published.publicToken, who.name, who.email);
  }
  const plan = await loadPlan(deps.db, published.manageToken);
  const miaToken = plan!.commits.filter((c) => !c.isCreator).at(-1)!.withdrawToken;
  return { deps, app, published, miaToken };
}

describe('GET /w/:token', () => {
  it('shows the confirm page, is noindex and changes nothing (AC1)', async () => {
    const { deps, app, published, miaToken } = await pageWith();

    const res = await app.request(`/w/${miaToken}`);
    await app.request(`/w/${miaToken}`);

    expect(res.status).toBe(200);
    const body = decodeEntities(await res.text());
    expect(body).toContain(CONFIRM_HEADING);
    expect(body).toContain('>Withdraw</button>');
    expect(body).toContain('<meta name="robots" content="noindex"');
    const plan = await loadPlan(deps.db, published.manageToken);
    expect(plan?.count).toBe(2);
    expect(plan?.events.map((e) => e.type)).not.toContain('commit.withdrawn');
  });
});

describe('POST /w/:token', () => {
  it("withdraws, redirects to done and the page reads you're out (AC2)", async () => {
    const { deps, app, published, miaToken } = await pageWith();

    const res = await postWithdraw(app, miaToken);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/w/${miaToken}?done=1`);
    const body = decodeEntities(await (await app.request(`/w/${miaToken}?done=1`)).text());
    expect(body).toContain("<h1>You're out</h1>");
    expect(body).toContain("You've withdrawn from Coffee on Sat 14 Nov. No more emails about it.");
    expect(body).toContain('<a class="quiet" href="/">Suggest a plan</a>');
    expect(body).not.toContain('<form');
    const plan = await loadPlan(deps.db, published.manageToken);
    expect(plan?.count).toBe(1);
    expect(plan?.events.at(-1)).toEqual({ type: 'commit.withdrawn', data: { activeCount: 1 } });
    expect(deps.fakes.planWorkflows.signalCalls).toEqual([]);
  });

  it('withdrawing from a confirmed plan at its minimum keeps it confirmed (AC3)', async () => {
    const { deps, app, published, miaToken } = await pageWith('3', [{ name: 'Raj Rao', email: 'raj@example.test' }]);

    const res = await postWithdraw(app, miaToken);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/w/${miaToken}?done=1`);
    const plan = await loadPlan(deps.db, published.manageToken);
    expect(plan?.state).toBe('confirmed');
    expect(deps.fakes.planWorkflows.signalCalls).toEqual([{ planId: plan?.id, signal: 'confirmed', arg: undefined }]);
  });

  it('a second POST writes nothing and redirects to done (AC4)', async () => {
    const { deps, app, published, miaToken } = await pageWith();

    const first = await postWithdraw(app, miaToken);
    const second = await postWithdraw(app, miaToken);

    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toBe(`/w/${miaToken}?done=1`);
    expect(second.status).toBe(303);
    expect(second.headers.get('location')).toBe(`/w/${miaToken}?done=1`);
    const plan = await loadPlan(deps.db, published.manageToken);
    expect(plan?.events.filter((e) => e.type === 'commit.withdrawn')).toHaveLength(1);
    expect(plan?.count).toBe(1);
  });
});

describe('committing again after withdrawing', () => {
  it('makes the commit active and the withdraw page shows confirm (AC5)', async () => {
    const { deps, app, published, miaToken } = await pageWith();
    await postWithdraw(app, miaToken);

    const res = await postCommit(app, published.publicToken, 'Mia Chen', 'mia@example.test');

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/p/${published.publicToken}?notice=in&n=Mia`);
    const plan = await loadPlan(deps.db, published.manageToken);
    expect(plan?.count).toBe(2);
    expect(plan?.events.at(-1)).toMatchObject({ type: 'commit.added', data: { change: 'rejoined' } });
    for (const path of [`/w/${miaToken}`, `/w/${miaToken}?done=1`]) {
      const body = decodeEntities(await (await app.request(path)).text());
      expect(body, path).toContain(CONFIRM_HEADING);
      expect(body, path).toContain('>Withdraw</button>');
      expect(body, path).not.toContain("You're out");
    }
  });

  it('a rejoin on a confirmed plan signals committed with her commit id (AC6)', async () => {
    const { deps, app, published, miaToken } = await pageWith('3', [{ name: 'Raj Rao', email: 'raj@example.test' }]);
    const view = await loadPlan(deps.db, published.manageToken);
    const rajToken = view!.commits.filter((c) => !c.isCreator)[0]!.withdrawToken;
    await postWithdraw(app, miaToken);
    await postWithdraw(app, rajToken);

    const res = await postCommit(app, published.publicToken, 'Mia Chen', 'mia@example.test');

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/p/${published.publicToken}?notice=on&n=Mia`);
    const signals = deps.fakes.planWorkflows.signalCalls;
    expect(signals).toHaveLength(2);
    expect(signals[0]).toEqual({ planId: view?.id, signal: 'confirmed', arg: undefined });
    expect(signals[1]).toEqual({ planId: view?.id, signal: 'committed', arg: expect.any(String) });

    await postCommit(app, published.publicToken, 'Raj Rao', 'raj@example.test');

    expect(signals).toHaveLength(3);
    expect(signals[2]?.signal).toBe('committed');
    expect(signals[2]?.arg).toEqual(expect.any(String));
    expect(signals[2]?.arg).not.toBe(signals[1]?.arg);
  });
});

describe('the withdraw link in other situations', () => {
  it("the creator's token is 404 for GET and POST (AC7)", async () => {
    const { deps, app, published } = await pageWith();
    const view = await loadPlan(deps.db, published.manageToken);
    const anaToken = view!.commits.find((c) => c.isCreator)!.withdrawToken;
    const unknownBody = await (await app.request(`/w/${newToken()}`)).text();

    const get = await app.request(`/w/${anaToken}`);
    const post = await postWithdraw(app, anaToken);

    expect(get.status).toBe(404);
    expect(await get.text()).toBe(unknownBody);
    expect(decodeEntities(unknownBody)).toContain(NOT_FOUND_COPY);
    expect(post.status).toBe(404);
    expect(await post.text()).toBe(unknownBody);
    expect((await loadPlan(deps.db, published.manageToken))?.count).toBe(2);
  });

  it('a started plan reads already started with no button and a POST writes nothing (AC8)', async () => {
    const { deps, published, miaToken } = await pageWith();
    const started = createApp({ ...deps, now: fixedClock('2026-11-14T18:00:00Z') }, { baseUrl: TEST_BASE_URL });

    const get = await started.request(`/w/${miaToken}`);
    const post = await postWithdraw(started, miaToken);

    const body = decodeEntities(await get.text());
    expect(body).toContain('This one has already started.');
    expect(body).toContain('<a class="quiet" href="/">Suggest a plan</a>');
    expect(body).not.toContain('<form');
    expect(post.status).toBe(303);
    expect(post.headers.get('location')).toBe(`/w/${miaToken}`);
    const plan = await loadPlan(deps.db, published.manageToken);
    expect(plan?.count).toBe(2);
    expect(plan?.events.map((e) => e.type)).not.toContain('commit.withdrawn');
  });

  it('a called-off plan reads nothing to withdraw from, with no button (AC8)', async () => {
    const { deps, app, published, miaToken } = await pageWith();
    await resolveDeadline(deps.db, published.planId);

    const res = await app.request(`/w/${miaToken}`);

    expect(res.status).toBe(200);
    const body = decodeEntities(await res.text());
    expect(body).toContain("This one isn't going ahead, so there's nothing to withdraw from.");
    expect(body).toContain('<a class="quiet" href="/">Suggest a plan</a>');
    expect(body).not.toContain('<button');
  });

  it('a malformed token is 404 without a database query (AC9)', async () => {
    const throwingDb = new Proxy(
      {},
      {
        get() {
          throw new Error('database touched');
        },
      },
    ) as ReturnType<typeof testDeps>['db'];
    const app = createApp(testDeps({ db: throwingDb }), { baseUrl: TEST_BASE_URL });

    const get = await app.request('/w/not-a-token');
    const post = await postWithdraw(app, 'not-a-token');

    expect(get.status).toBe(404);
    expect(decodeEntities(await get.text())).toContain(NOT_FOUND_COPY);
    expect(post.status).toBe(404);
    expect(decodeEntities(await post.text())).toContain(NOT_FOUND_COPY);
  });
});

describe('the withdraw page copy and way back', () => {
  const COME_OFF = "You'll come off the list, and we won't email you about it again.";
  const raj = { name: 'Raj Rao', email: 'raj@example.test' };

  it('an open plan needing 1 more shows the heading, the sentence, Withdraw and Stay in (AC1)', async () => {
    const { app, published, miaToken } = await pageWith('3');

    const res = await app.request(`/w/${miaToken}`);

    const body = decodeEntities(await res.text());
    expect(body).toContain(CONFIRM_HEADING);
    expect(body).toContain(COME_OFF);
    expect(body).toContain('>Withdraw</button>');
    expect(body).toContain(`<a class="quiet" href="/p/${published.publicToken}">Stay in</a>`);
    expect(body).not.toContain('It stays on for everyone else.');
  });

  it('a confirmed plan reads "It stays on for everyone else." first (AC2)', async () => {
    const { app, miaToken } = await pageWith('3', [raj]);

    const body = decodeEntities(await (await app.request(`/w/${miaToken}`)).text());

    expect(body).toContain(`It stays on for everyone else. ${COME_OFF}`);
  });

  it('following Stay in leaves him in and the count unchanged (AC3)', async () => {
    const { deps, app, published, miaToken } = await pageWith('3');
    const body = decodeEntities(await (await app.request(`/w/${miaToken}`)).text());
    const href = /href="(\/p\/[^"]+)">Stay in<\/a>/.exec(body)?.[1];

    const res = await app.request(href!);

    expect(res.status).toBe(200);
    const plan = await loadPlan(deps.db, published.manageToken);
    expect(plan?.count).toBe(2);
    expect(plan?.events.map((e) => e.type)).not.toContain('commit.withdrawn');
  });

  it('every withdraw page has no email, no committer name and carries noindex (AC4)', async () => {
    const bodies: string[] = [];
    const get = async (app: ReturnType<typeof createApp>, token: string, suffix = '') =>
      bodies.push(decodeEntities(await (await app.request(`/w/${token}${suffix}`)).text()));

    const confirm = await pageWith('3', [raj]);
    await get(confirm.app, confirm.miaToken);
    await postWithdraw(confirm.app, confirm.miaToken);
    await get(confirm.app, confirm.miaToken, '?done=1');

    const startedPlan = await pageWith('3', [raj]);
    // Raj committed before Mia, so he is the first non-creator commit.
    const rajToken = (await loadPlan(startedPlan.deps.db, startedPlan.published.manageToken))!.commits.filter(
      (c) => !c.isCreator,
    )[0]!.withdrawToken;
    const started = createApp(
      { ...startedPlan.deps, now: fixedClock('2026-11-14T18:00:00Z') },
      { baseUrl: TEST_BASE_URL },
    );
    await get(started, rajToken);

    const calledOff = await pageWith('3', [raj]);
    await callOff(calledOff.deps, calledOff.published.manageToken);
    await get(calledOff.app, calledOff.miaToken);

    expect(bodies).toHaveLength(4);
    for (const body of bodies) {
      expect(body).not.toMatch(/@/);
      for (const name of ['Ana', 'Mia', 'Raj']) expect(body).not.toContain(name);
      expect(body).toContain('<meta name="robots" content="noindex"');
    }
  });
});
