import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { commit, loadPlan, withdraw } from '../domain/plans.ts';
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
