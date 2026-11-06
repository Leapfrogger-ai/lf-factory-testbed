import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { commit, loadPlan, loadSendTargets, withdraw } from '../domain/plans.ts';
import { commitFormSchema } from '../web/forms.ts';
import { publishPlan, TEST_BASE_URL, testDeps } from '../../tests/support/builders.ts';
import { resetDb, testDb } from '../../tests/support/db.ts';
import { createActivities } from './activities.ts';

const { db, pool } = testDb();

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const form = (name: string, email: string) => commitFormSchema.parse({ name, email });

// Ann publishes (the creator); the others commit in order. Returns the withdraw tokens of the others.
async function setup(others: [string, string][], minimum = '3') {
  const deps = testDeps();
  const published = await publishPlan(deps, { minimum });
  for (const [name, email] of others) await commit(deps, published.publicToken, form(name, email));
  const plan = await loadPlan(db, published.manageToken);
  const withdrawTokens = plan!.commits.filter((c) => !c.isCreator).map((c) => c.withdrawToken);
  const activities = createActivities({ db, sendEmail: deps.sendEmail, baseUrl: TEST_BASE_URL });
  return { deps, published, withdrawTokens, activities };
}

const recipients = (deps: Awaited<ReturnType<typeof setup>>['deps']) =>
  deps.fakes.email.calls.map((c) => (c.payload as { to: string }).to);

describe('sendToCommitters not_this_time', () => {
  it('sends one email to each active committer of a called-off plan', async () => {
    const { deps, published, activities } = await setup([['Mia', 'mia@example.test']]);
    await activities.resolveDeadline(published.planId);

    await activities.sendToCommitters(published.planId, 'not_this_time');

    const payloads = deps.fakes.email.calls.map((c) => c.payload as { to: string; subject: string });
    expect(payloads.map((p) => p.subject)).toEqual([
      'Not this time: Coffee on Sat 14 Nov',
      'Not this time: Coffee on Sat 14 Nov',
    ]);
    expect(payloads.map((p) => p.to)).toEqual(['ann@example.test', 'mia@example.test']);
  });

  it('sends nothing to a committer who withdrew', async () => {
    const { deps, published, withdrawTokens, activities } = await setup(
      [
        ['Mia', 'mia@example.test'],
        ['Raj', 'raj@example.test'],
      ],
      '4',
    );
    await withdraw(deps, withdrawTokens[1]!);
    await activities.resolveDeadline(published.planId);

    await activities.sendToCommitters(published.planId, 'not_this_time');

    expect(recipients(deps)).toEqual(['ann@example.test', 'mia@example.test']);
  });

  it('sends nothing while the plan is open', async () => {
    const { deps, published, activities } = await setup([['Mia', 'mia@example.test']]);

    await activities.sendToCommitters(published.planId, 'not_this_time');

    expect(deps.fakes.email.calls).toHaveLength(0);
  });

  it('sends nothing for a confirmed plan', async () => {
    const { deps, published, activities } = await setup([
      ['Mia', 'mia@example.test'],
      ['Raj', 'raj@example.test'],
    ]);
    expect(await activities.resolveDeadline(published.planId)).toBe('confirmed');

    await activities.sendToCommitters(published.planId, 'not_this_time');

    expect(deps.fakes.email.calls).toHaveLength(0);
  });

  it('a retry after a failed first send still sends exactly one email each', async () => {
    const { deps, published, activities } = await setup([['Mia', 'mia@example.test']]);
    await activities.resolveDeadline(published.planId);
    deps.fakes.email.failNext();

    await expect(activities.sendToCommitters(published.planId, 'not_this_time')).rejects.toThrow('email send failed');
    await activities.sendToCommitters(published.planId, 'not_this_time');

    expect(recipients(deps)).toEqual(['ann@example.test', 'mia@example.test']);
    const view = await loadPlan(db, published.manageToken);
    const sent = view!.events.filter((e) => e.type === 'email.sent');
    expect(sent).toHaveLength(2);
  });

  it('is idempotent', async () => {
    const { deps, published, activities } = await setup([['Mia', 'mia@example.test']]);
    await activities.resolveDeadline(published.planId);

    await activities.sendToCommitters(published.planId, 'not_this_time');
    await activities.sendToCommitters(published.planId, 'not_this_time');

    expect(deps.fakes.email.calls).toHaveLength(2);
  });

  it('throws for a kind the activity does not support', async () => {
    const { published, activities } = await setup([]);

    await expect(activities.sendToCommitters(published.planId, 'manage_link')).rejects.toThrow(
      'No activity support for manage_link',
    );
  });
});

const SUBJECT = "It's on: Coffee at Blue Bottle, Sat 14 Nov 10:00 AM";
type Sent = { to: string; subject: string; text: string };
const sent = (deps: Awaited<ReturnType<typeof setup>>['deps']) => deps.fakes.email.calls.map((c) => c.payload as Sent);

describe('sendToCommitters confirmed', () => {
  it('sends one email per active committer', async () => {
    const { deps, published, withdrawTokens, activities } = await setup([
      ['Mia', 'mia@example.test'],
      ['Raj', 'raj@example.test'],
    ]);
    expect(await activities.resolveDeadline(published.planId)).toBe('confirmed');

    await activities.sendToCommitters(published.planId, 'confirmed');
    await activities.sendToCommitters(published.planId, 'confirmed');

    const payloads = sent(deps);
    expect(payloads).toHaveLength(3);
    expect(payloads.map((p) => p.subject)).toEqual([SUBJECT, SUBJECT, SUBJECT]);
    const mia = payloads.find((p) => p.to === 'mia@example.test')!;
    expect(mia.text).toContain(`https://calvin.test/w/${withdrawTokens[0]}`);
    const ann = payloads.find((p) => p.to === 'ann@example.test')!;
    expect(ann.text).not.toContain('/w/');
  });

  it('skips a committer who withdrew before confirmation', async () => {
    const { deps, published, withdrawTokens, activities } = await setup(
      [
        ['Mia', 'mia@example.test'],
        ['Raj', 'raj@example.test'],
      ],
      '4',
    );
    await withdraw(deps, withdrawTokens[1]!);
    await commit(deps, published.publicToken, form('Lee', 'lee@example.test'));
    await commit(deps, published.publicToken, form('Sam', 'sam@example.test'));

    await activities.sendToCommitters(published.planId, 'confirmed');

    expect(recipients(deps)).toEqual(['ann@example.test', 'mia@example.test', 'lee@example.test', 'sam@example.test']);
    expect(sent(deps)[0]!.text.split('\n')[0]).toBe("It's on. Ann, Mia, Lee, Sam are in.");
  });

  it('sends nothing while the plan is open or called off', async () => {
    const open = await setup([['Mia', 'mia@example.test']]);
    await open.activities.sendToCommitters(open.published.planId, 'confirmed');
    expect(open.deps.fakes.email.calls).toHaveLength(0);

    const off = await setup([['Mia', 'mia@example.test']]);
    await off.activities.resolveDeadline(off.published.planId);
    await off.activities.sendToCommitters(off.published.planId, 'confirmed');
    expect(off.deps.fakes.email.calls).toHaveLength(0);
  });
});

describe('sendToOne', () => {
  it('sends only to the named active committer', async () => {
    const { deps, published, activities } = await setup([
      ['Mia', 'mia@example.test'],
      ['Raj', 'raj@example.test'],
    ]);
    const lee = await commit(deps, published.publicToken, form('Lee', 'lee@example.test'));
    if (lee.outcome !== 'committed') throw new Error('Lee should commit');

    await activities.sendToOne(published.planId, 'confirmed', lee.commitId);
    await activities.sendToOne(published.planId, 'confirmed', lee.commitId);

    expect(recipients(deps)).toEqual(['lee@example.test']);
    expect(sent(deps)[0]!.text.split('\n')[0]).toBe("It's on. Ann, Mia, Raj, Lee are in.");
  });

  it('ignores a withdrawn committer and a non-confirmed plan', async () => {
    const { deps, published, withdrawTokens, activities } = await setup([
      ['Mia', 'mia@example.test'],
      ['Raj', 'raj@example.test'],
    ]);
    const raj = (await loadSendTargets(db, published.planId)).commits[2]!;
    await withdraw(deps, withdrawTokens[1]!);
    await activities.sendToOne(published.planId, 'confirmed', raj.id);

    const open = await setup([['Mia', 'mia@example.test']]);
    const mia = (await loadSendTargets(db, open.published.planId)).commits[1]!;
    await open.activities.sendToOne(open.published.planId, 'confirmed', mia.id);

    expect(deps.fakes.email.calls).toHaveLength(0);
    expect(open.deps.fakes.email.calls).toHaveLength(0);
  });

  it('does not email a rejoined committer again', async () => {
    const { deps, published, withdrawTokens, activities } = await setup([
      ['Mia', 'mia@example.test'],
      ['Raj', 'raj@example.test'],
    ]);
    await activities.sendToCommitters(published.planId, 'confirmed');
    await withdraw(deps, withdrawTokens[0]!);
    const rejoin = await commit(deps, published.publicToken, form('Mia', 'mia@example.test'));
    if (rejoin.outcome !== 'committed') throw new Error('Mia should rejoin');
    const before = deps.fakes.email.calls.length;

    await activities.sendToOne(published.planId, 'confirmed', rejoin.commitId);

    expect(deps.fakes.email.calls).toHaveLength(before);
  });
});

describe('reminders', () => {
  const threeIn = () =>
    setup([
      ['Mia', 'mia@example.test'],
      ['Raj', 'raj@example.test'],
    ]);

  it('sends the 24h reminder to every active committer, once', async () => {
    const { deps, published, activities } = await threeIn();

    await activities.sendToCommitters(published.planId, 'reminder_24h');
    await activities.sendToCommitters(published.planId, 'reminder_24h');

    const payloads = sent(deps);
    expect(payloads).toHaveLength(3);
    for (const p of payloads) expect(p.text).toContain("Who's in: Ann, Mia, Raj.");
  });

  it('leaves a withdrawn committer out of the morning reminder and the list', async () => {
    const { deps, published, withdrawTokens, activities } = await threeIn();
    await withdraw(deps, withdrawTokens[1]!);

    await activities.sendToCommitters(published.planId, 'reminder_morning');

    expect(recipients(deps)).toEqual(['ann@example.test', 'mia@example.test']);
    for (const p of sent(deps)) {
      expect(p.text).toContain("Who's in: Ann, Mia.");
      expect(p.text).not.toContain('Raj');
    }
  });

  it('sends nothing while the plan is open or called off', async () => {
    const open = await setup([['Mia', 'mia@example.test']]);
    await open.activities.sendToCommitters(open.published.planId, 'reminder_24h');
    expect(open.deps.fakes.email.calls).toHaveLength(0);

    const off = await setup([['Mia', 'mia@example.test']]);
    await off.activities.resolveDeadline(off.published.planId);
    await off.activities.sendToCommitters(off.published.planId, 'reminder_24h');
    expect(off.deps.fakes.email.calls).toHaveLength(0);
  });

  it('sendToOne sends the reminder only to the named committer', async () => {
    const { deps, published, activities } = await threeIn();
    const mia = (await loadSendTargets(db, published.planId)).commits[1]!;

    await activities.sendToOne(published.planId, 'reminder_morning', mia.id);

    expect(recipients(deps)).toEqual(['mia@example.test']);
  });

  it('a committer who withdraws and rejoins gets exactly one 24h reminder', async () => {
    const { deps, published, withdrawTokens, activities } = await threeIn();
    await activities.sendToCommitters(published.planId, 'reminder_24h');
    await withdraw(deps, withdrawTokens[0]!);
    const rejoin = await commit(deps, published.publicToken, form('Mia', 'mia@example.test'));
    if (rejoin.outcome !== 'committed') throw new Error('Mia should rejoin');

    await activities.sendToCommitters(published.planId, 'reminder_24h');

    expect(recipients(deps).filter((to) => to === 'mia@example.test')).toHaveLength(1);
  });
});

describe('resolveDeadline', () => {
  it('returns called_off for a plan below its minimum', async () => {
    const { published, activities } = await setup([['Mia', 'mia@example.test']]);

    expect(await activities.resolveDeadline(published.planId)).toBe('called_off');
  });

  it('returns confirmed for a plan that confirmed through commit', async () => {
    const { published, activities } = await setup([
      ['Mia', 'mia@example.test'],
      ['Raj', 'raj@example.test'],
    ]);

    expect(await activities.resolveDeadline(published.planId)).toBe('confirmed');
  });
});
