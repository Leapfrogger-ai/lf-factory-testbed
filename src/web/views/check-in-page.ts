import { brand } from './layout.ts';
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { CheckInQuestion } from '../../domain/plans.ts';
import { formatWhen } from '../../domain/time.ts';
import { capitalise } from './public-plan-page.ts';

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
  plan,
}: {
  token: string;
  question: CheckInQuestion;
  answer: boolean;
  next: CheckInQuestion | null;
  plan: { format: string; venue: string; gatheringAt: Temporal.Instant };
}): HtmlEscapedString {
  const followUp = next
    ? html`<h2>${heading[next]}</h2>
    <div class="answers">
      <a class="btn btn-primary" href="/c/${token}/${next}/yes">Yes</a>
      <a class="btn btn-secondary" href="/c/${token}/${next}/no">No</a>
    </div>`
    : html`<p class="meta">Tapped the wrong one? Use the links in the email again; the last tap counts.</p>
      <a class="quiet" href="/">Suggest another plan</a>`;
  return html`<main>
    ${brand}
    <div class="context">
      <p class="kind">${capitalise(plan.format)} at ${plan.venue}</p>
      <p class="when">${formatWhen(plan.gatheringAt)}</p>
    </div>
    <h1>${thanks[question][answer ? 'yes' : 'no']}</h1>
    ${followUp}
  </main>` as HtmlEscapedString;
}
