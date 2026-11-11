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

  describe('creator call-off', () => {
    const calledOffByCreator: PlanRow = { ...plan, calledOffReason: 'creator' };
    const creator = commit(true);
    const joiner = commit(false);
    const active = [creator, joiner];

    it('a creator call-off builds the Called off email', () => {
      const payload = buildEmail('not_this_time', calledOffByCreator, joiner, 'https://example.test', active);
      expect(payload.subject).toBe('Called off: Coffee on Sat 14 Nov');
      expect(payload.text).toBe('Casey called off Coffee at Blue Bottle. Nothing to do.\n');
      expect(payload.to).toBe(joiner.email);
      expect(payload.tags).toEqual([{ name: 'kind', value: 'not_this_time' }]);
    });

    it('a creator call-off email has no link, count or other name (AC5)', () => {
      const { text } = buildEmail('not_this_time', calledOffByCreator, joiner, 'https://example.test', active);
      expect(text).not.toContain('/w/');
      expect(text).not.toContain(joiner.withdrawToken);
      expect(text).not.toMatch(/\d/);
      expect(text).not.toContain('Pat');
      expect(text).toContain('Casey');
      expect(text).not.toContain('Creator');
    });
  });
});

describe('buildEmail check_in', () => {
  const base = 'https://example.test';
  const link = '/c/checkintokencheckintoken';

  it('builds the subject and exact body for the creator (AC1)', () => {
    const payload = buildEmail('check_in', plan, commit(true), base);
    expect(payload.to).toBe('casey@example.test');
    expect(payload.subject).toBe('Did it happen? Coffee on Sat 14 Nov');
    expect(payload.tags).toEqual([{ name: 'kind', value: 'check_in' }]);
    expect(payload.text).toBe(
      [
        'Hi Casey,',
        'Coffee at Blue Bottle was yesterday. Two quick taps, please.',
        'Did it happen?',
        `Yes: ${base}${link}/happened/yes`,
        `No: ${base}${link}/happened/no`,
        'Were you there?',
        `Yes: ${base}${link}/attended/yes`,
        `No: ${base}${link}/attended/no`,
        'Thanks!',
        '',
      ].join('\n'),
    );
  });

  it('has no withdraw URL and no other committer name (AC2)', () => {
    const joiner = commit(false);
    const { text } = buildEmail('check_in', plan, joiner, base, [commit(true), joiner]);
    expect(text).not.toContain('/w/');
    expect(text).not.toContain('withdrawtokenwithdrawtoken');
    expect(text).not.toContain('Casey');
    const creatorText = buildEmail('check_in', plan, commit(true), base, [commit(true), joiner]).text;
    expect(creatorText).not.toContain('Pat');
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
    expect(text).toContain('Map: https://maps.google.com/?q=Tom+%26+Jerry%27s+San+Jos%C3%A9\n');
  });

  it('one name', () => {
    const { text } = buildEmail('confirmed', confirmedPlan, ana, 'https://example.test', [ana]);
    expect(text.split('\n')[0]).toBe("It's on. Ana are in.");
  });
});

describe('buildEmail reminders', () => {
  const base = 'https://example.test';
  const reminderPlan: PlanRow = { ...plan, state: 'confirmed', city: 'Oakland' };

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

  const ann = named('Ann', true);
  const mia = named('Mia', false);
  const raj = named('Raj', false);
  const active = [ann, mia, raj];

  const body = (lead: string, withdraw: boolean) =>
    [
      `${lead} at 10:00 AM: Coffee at Blue Bottle, Oakland.`,
      'Map: https://maps.google.com/?q=Blue+Bottle+Oakland',
      "Who's in: Ann, Mia, Raj.",
      ...(withdraw ? ["Can't make it? Withdraw: https://example.test/w/withdraw-Mia"] : []),
    ].join('\n');

  it('reminder_24h for a joiner', () => {
    const payload = buildEmail('reminder_24h', reminderPlan, mia, base, active);
    expect(payload.to).toBe('mia@example.test');
    expect(payload.subject).toBe('Tomorrow: Coffee at Blue Bottle, 10:00 AM');
    expect(payload.text).toBe(body('Tomorrow', true));
    expect(payload.tags).toEqual([{ name: 'kind', value: 'reminder_24h' }]);
  });

  it('reminder_morning for a joiner', () => {
    const payload = buildEmail('reminder_morning', reminderPlan, mia, base, active);
    expect(payload.subject).toBe('Today: Coffee at Blue Bottle, 10:00 AM');
    expect(payload.text).toBe(body('Today', true));
    expect(payload.tags).toEqual([{ name: 'kind', value: 'reminder_morning' }]);
  });

  it.each([
    ['reminder_24h', 'Tomorrow'],
    ['reminder_morning', 'Today'],
  ] as const)('%s for the creator has no withdraw line', (kind, lead) => {
    const { text } = buildEmail(kind, reminderPlan, ann, base, active);
    expect(text).toBe(body(lead, false));
    expect(text).not.toContain("Can't make it?");
    expect(text).not.toContain('/w/');
  });

  it('lists a single active person without a comma', () => {
    const { text } = buildEmail('reminder_24h', reminderPlan, ann, base, [ann]);
    expect(text).toContain("Who's in: Ann.");
    expect(text).not.toContain("Who's in: Ann,");
  });

  it('encodes the map link', () => {
    const odd: PlanRow = { ...reminderPlan, venue: 'Joe & Co', city: 'San Francisco' };
    const { text } = buildEmail('reminder_morning', odd, mia, base, active);
    expect(text).toContain('Map: https://maps.google.com/?q=Joe+%26+Co+San+Francisco\n');
  });
});
