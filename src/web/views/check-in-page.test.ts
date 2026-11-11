import { describe, expect, it } from 'vitest';
import type { CheckInQuestion } from '../../domain/plans.ts';
import { checkInPage } from './check-in-page.ts';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

const plan = {
  format: 'coffee',
  venue: 'Blue Bottle',
  gatheringAt: Temporal.Instant.from('2026-11-14T18:00:00Z'),
};

const render = (
  question: CheckInQuestion,
  answer: boolean,
  next: CheckInQuestion | null,
  planOverride = plan,
) =>
  String(checkInPage({ token: TOKEN, question, answer, next, plan: planOverride })).replaceAll(
    '&#39;',
    "'",
  );

describe('checkInPage thank-you copy', () => {
  it.each([
    ['happened', true, 'Thanks! Got it: it happened.'],
    ['happened', false, "Thanks! Got it: it didn't happen."],
    ['attended', true, 'Thanks! Got it: you were there.'],
    ['attended', false, "Thanks! Got it: you weren't there."],
  ] as const)('%s / %s says the exact copy and offers nothing more', (question, answer, copy) => {
    const out = render(question, answer, null);
    expect(out).toContain(copy);
    expect(out).not.toContain('Did it happen?');
    expect(out).not.toContain('Were you there?');
    expect(out).not.toContain('href="/c/');
  });

  it('offers the other question with Yes and No links', () => {
    const afterHappened = render('happened', true, 'attended');
    expect(afterHappened).toContain('Were you there?');
    expect(afterHappened).toContain(`href="/c/${TOKEN}/attended/yes"`);
    expect(afterHappened).toContain(`href="/c/${TOKEN}/attended/no"`);

    const afterAttended = render('attended', true, 'happened');
    expect(afterAttended).toContain('Did it happen?');
    expect(afterAttended).toContain(`href="/c/${TOKEN}/happened/yes"`);
    expect(afterAttended).toContain(`href="/c/${TOKEN}/happened/no"`);
  });

  it('opens with the plan block before the heading', () => {
    const out = render('happened', true, 'attended');
    expect(out).toContain('<p class="kind">Coffee at Blue Bottle</p>');
    expect(out).toContain('<p class="when">Sat 14 Nov · 10:00 AM</p>');
    expect(out.indexOf('class="context"')).toBeLessThan(out.indexOf('<h1>'));
  });

  it('escapes the venue', () => {
    const out = render('happened', true, null, { ...plan, venue: '<b>x</b>' });
    expect(out).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(out).not.toContain('<b>x</b>');
  });

  it('puts Yes primary and No secondary inside .answers', () => {
    const out = render('happened', true, 'attended');
    expect(out).toMatch(
      new RegExp(
        `class="answers">\\s*<a class="btn btn-primary" href="/c/${TOKEN}/attended/yes">Yes</a>\\s*<a class="btn btn-secondary" href="/c/${TOKEN}/attended/no">No</a>`,
      ),
    );
  });

  it('still asks "Were you there?" after "it didn\'t happen"', () => {
    const out = render('happened', false, 'attended');
    expect(out).toContain("Thanks! Got it: it didn't happen.");
    expect(out).toContain('Were you there?');
    expect(out).toContain(`href="/c/${TOKEN}/attended/yes"`);
    expect(out).toContain(`href="/c/${TOKEN}/attended/no"`);
  });

  it('finished page has the wrong-tap line, a quiet Suggest another plan link and no answer links', () => {
    const out = render('attended', true, null);
    expect(out).toContain(
      '<p class="meta">Tapped the wrong one? Use the links in the email again; the last tap counts.</p>',
    );
    expect(out).toContain('<a class="quiet" href="/">Suggest another plan</a>');
    expect(out).not.toContain('btn-primary');
    expect(out).not.toContain('btn-secondary');
    expect(out).not.toContain('href="/c/');
  });
});
