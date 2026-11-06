import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { emailSends, events } from '../db/schema.ts';
import { loadSendTarget } from '../domain/plans.ts';
import { publishPlan, TEST_BASE_URL, testDeps } from '../../tests/support/builders.ts';
import { resetDb, testDb } from '../../tests/support/db.ts';
import { sendOnce } from './send.ts';

const { db, pool } = testDb();

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

async function setup(overrides: Record<string, string> = {}) {
  const deps = testDeps();
  const published = await publishPlan(deps, overrides);
  const { plan, commit } = await loadSendTarget(db, published.planId);
  const send = () => sendOnce({ db, sendEmail: deps.sendEmail, baseUrl: TEST_BASE_URL }, 'manage_link', plan, commit);
  return { deps, published, plan, commit, send };
}

describe('sendOnce manage_link', () => {
  it('sends the manage-link email built from stored data', async () => {
    const { deps, published, send } = await setup();

    await send();

    const calls = deps.fakes.email.calls;
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    const payload = call.payload as { to: string; subject: string; text: string; tags: unknown };
    expect(payload.to).toBe('ann@example.test');
    expect(payload.subject).toBe('Your plan: Coffee at Blue Bottle, Sat 14 Nov');
    expect(payload.tags).toEqual([{ name: 'kind', value: 'manage_link' }]);
    expect(call.idempotencyKey).toBe(`manage_link/${published.planId}/${published.creatorCommitId}`);
    expect(payload.text).toContain(`https://calvin.test/m/${published.manageToken}`);
    expect(payload.text).toContain(`https://calvin.test/p/${published.publicToken}`);
    expect(payload.text).toContain('Paste this one in your chat:');
    expect(payload.text).not.toMatch(/withdraw/i);
    expect(payload).not.toHaveProperty('html');
  });

  it('sends once however many times it is called', async () => {
    const { deps, published, send } = await setup();

    await send();
    await send();

    expect(deps.fakes.email.calls).toHaveLength(1);
    const rows = await db.select().from(emailSends);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sentAt).toBeInstanceOf(Date);
    expect(rows[0]?.resendId).toBe('email-1');
    const sent = await db.select().from(events).where(eq(events.type, 'email.sent'));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.data).toEqual({ kind: 'manage_link', resendId: 'email-1' });
    expect(sent[0]?.planId).toBe(published.planId);
    expect(sent[0]?.commitId).toBe(published.creatorCommitId);
  });

  it('a failed send leaves the ledger row unsent and the retry repeats the same payload and key', async () => {
    const { deps, send } = await setup();
    deps.fakes.email.failNext();

    await expect(send()).rejects.toThrow('email send failed');
    const rows = await db.select().from(emailSends);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sentAt).toBeNull();

    await send();

    const attempts = deps.fakes.email.attempts;
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(deps.fakes.email.calls).toHaveLength(1);
  });

  it('two concurrent calls for one commit record one row and one email.sent event', async () => {
    const { send } = await setup();

    await Promise.all([send(), send()]);

    expect(await db.select().from(emailSends)).toHaveLength(1);
    expect(await db.select().from(events).where(eq(events.type, 'email.sent'))).toHaveLength(1);
  });

  it('puts the venue verbatim in the subject and text', async () => {
    const venue = 'Fish & Chips <b>"Co"</b>';
    const { deps, send } = await setup({ venue });

    await send();

    const payload = deps.fakes.email.calls[0]!.payload as { subject: string; text: string };
    expect(payload.subject).toContain(venue);
    expect(payload.text).toContain(venue);
  });

  it('throws for a kind with no template', async () => {
    const { deps, plan, commit } = await setup();

    await expect(
      sendOnce({ db, sendEmail: deps.sendEmail, baseUrl: TEST_BASE_URL }, 'check_in', plan, commit),
    ).rejects.toThrow('No email template for check_in');
  });
});
