import { describe, expect, it } from 'vitest';
import type { CommitRow, PlanRow } from '../domain/plans.ts';
import { buildEmail } from './templates.ts';

const plan: PlanRow = {
  id: '00000000-0000-4000-8000-000000000001',
  publicToken: 'pubtokenpubtokenpubtoken',
  manageToken: 'managetokenmanagetoken',
  checkInToken: 'checkintokencheckintoken',
  suggestionId: null,
  suggestionEdited: null,
  fromPlanId: null,
  city: 'Portland',
  area: 'Downtown',
  timeWindow: 'Saturday afternoon',
  format: 'coffee',
  venue: 'Blue Bottle',
  gatheringAt: new Date('2026-11-14T18:00:00Z'),
  commitDeadlineAt: new Date('2026-11-13T18:00:00Z'),
  minimum: 3,
  state: 'called_off',
  confirmedAt: null,
  calledOffAt: new Date('2026-11-13T18:00:00Z'),
  calledOffReason: 'deadline',
  createdAt: new Date('2026-11-01T18:00:00Z'),
};

function commit(isCreator: boolean): CommitRow {
  const email = isCreator ? 'casey@example.test' : 'pat@example.test';
  return {
    id: '00000000-0000-4000-8000-000000000002',
    planId: plan.id,
    name: isCreator ? 'Casey Creator' : 'Pat Joiner',
    email,
    emailNormalized: email,
    isCreator,
    withdrawToken: 'withdrawtokenwithdrawtoken',
    withdrawnAt: null,
    createdAt: new Date('2026-11-01T18:00:00Z'),
    updatedAt: new Date('2026-11-01T18:00:00Z'),
  };
}

describe('buildEmail not_this_time', () => {
  it('builds the subject, sentence, recipient and tag', () => {
    const c = commit(true);
    const payload = buildEmail('not_this_time', plan, c, 'https://example.test');
    expect(payload.subject).toBe('Not this time: Coffee on Sat 14 Nov');
    expect(payload.text).toContain(
      "This one didn't come together, and that's fine. Nobody's going, so there's nothing to do.",
    );
    expect(payload.to).toBe(c.email);
    expect(payload.tags).toEqual([{ name: 'kind', value: 'not_this_time' }]);
  });

  it.each([true, false])('has no link, name or count for creator=%s', (isCreator) => {
    const c = commit(isCreator);
    const { text } = buildEmail('not_this_time', plan, c, 'https://example.test');
    expect(text).not.toContain('/w/');
    expect(text).not.toContain(c.withdrawToken);
    expect(text).not.toContain(c.name);
    expect(text).not.toMatch(/\d/);
  });

  it('throws for a kind without a template', () => {
    expect(() => buildEmail('confirmed', plan, commit(true), 'https://example.test')).toThrow(
      'No email template for confirmed',
    );
  });
});
