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
    expect(() => buildEmail('check_in', plan, commit(true), 'https://example.test')).toThrow(
      'No email template for check_in',
    );
  });
});

describe('buildEmail confirmed', () => {
  const confirmedPlan: PlanRow = { ...plan, state: 'confirmed', city: 'Oakland' };

  function named(name: string, isCreator: boolean): CommitRow {
    const email = `${name.toLowerCase()}@example.test`;
    return {
      ...commit(isCreator),
      id: `id-${name}`,
      name,
      email,
      emailNormalized: email,
      withdrawToken: `withdraw-${name}`,
    };
  }

  const ana = named('Ana', true);
  const mia = named('Mia', false);
  const raj = named('Raj', false);
  const active = [ana, mia, raj];

  it('confirmed subject', () => {
    const payload = buildEmail('confirmed', confirmedPlan, mia, 'https://example.test', active);
    expect(payload.subject).toBe("It's on: Coffee at Blue Bottle, Sat 14 Nov 10:00 AM");
    expect(payload.to).toBe(mia.email);
    expect(payload.tags).toEqual([{ name: 'kind', value: 'confirmed' }]);
  });

  it('confirmed body for a joiner', () => {
    const { text } = buildEmail('confirmed', confirmedPlan, mia, 'https://example.test', active);
    expect(text).toBe(
      "It's on. Ana, Mia, Raj are in.\n\nCoffee at Blue Bottle\nSat 14 Nov · 10:00 AM\nMap: https://maps.google.com/?q=Blue+Bottle+Oakland\n\nWe'll remind you the day before and that morning.\n\nCan't make it? Withdraw: https://example.test/w/withdraw-Mia\n",
    );
  });

  it('confirmed body for the creator', () => {
    const { text } = buildEmail('confirmed', confirmedPlan, ana, 'https://example.test', active);
    expect(text).toBe(
      "It's on. Ana, Mia, Raj are in.\n\nCoffee at Blue Bottle\nSat 14 Nov · 10:00 AM\nMap: https://maps.google.com/?q=Blue+Bottle+Oakland\n\nWe'll remind you the day before and that morning.\n",
    );
    expect(text).not.toContain("Can't make it");
    expect(text).not.toContain('/w/');
  });

  it('map link encoding', () => {
    const odd: PlanRow = { ...confirmedPlan, venue: "Tom & Jerry's", city: 'San José' };
    const { text } = buildEmail('confirmed', odd, mia, 'https://example.test', active);
    const expected = 'https://maps.google.com/?q=' +
      new URLSearchParams({ q: "Tom & Jerry's San José" }).toString().slice(2);
    expect(text).toContain(`Map: ${expected}\n`);
  });

  it('one name', () => {
    const { text } = buildEmail('confirmed', confirmedPlan, ana, 'https://example.test', [ana]);
    expect(text.split('\n')[0]).toBe("It's on. Ana are in.");
  });
});
