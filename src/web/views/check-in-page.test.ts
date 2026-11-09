import { describe, expect, it } from 'vitest';
import type { CheckInQuestion } from '../../domain/plans.ts';
import { checkInPage } from './check-in-page.ts';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

const render = (question: CheckInQuestion, answer: boolean, next: CheckInQuestion | null) =>
  String(checkInPage({ token: TOKEN, question, answer, next })).replaceAll('&#39;', "'");

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
});
