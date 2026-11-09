import { brand } from './layout.ts';
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { CheckInQuestion } from '../../domain/plans.ts';

const thanks: Record<CheckInQuestion, { yes: string; no: string }> = {
  happened: { yes: 'Thanks! Got it: it happened.', no: "Thanks! Got it: it didn't happen." },
  attended: { yes: 'Thanks! Got it: you were there.', no: "Thanks! Got it: you weren't there." },
};

const heading: Record<CheckInQuestion, string> = {
  happened: 'Did it happen?',
  attended: 'Were you there?',
};

export function checkInPage({
  token,
  question,
  answer,
  next,
}: {
  token: string;
  question: CheckInQuestion;
  answer: boolean;
  next: CheckInQuestion | null;
}): HtmlEscapedString {
  const followUp = next
    ? html`<h2>${heading[next]}</h2>
    <a class="btn btn-primary" href="/c/${token}/${next}/yes">Yes</a>
    <a class="btn" href="/c/${token}/${next}/no">No</a>`
    : '';
  return html`<main>
    ${brand}
    <h1>${thanks[question][answer ? 'yes' : 'no']}</h1>
    ${followUp}
  </main>` as HtmlEscapedString;
}
