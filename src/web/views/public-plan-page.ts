import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { PublicPlan } from '../../domain/plans.ts';
import { formatDeadline, formatWhen } from '../../domain/time.ts';
import type { LayoutOptions } from './layout.ts';

type DisplayState = 'needs_more' | 'not_this_time' | 'on';

const FIRST_NAME_MAX = 16;

function firstName(fullName: string): string {
  const word = fullName.split(/\s+/).find((part) => part !== '') ?? '';
  return Array.from(word).slice(0, FIRST_NAME_MAX).join('');
}

function capitalise(text: string): string {
  const [first = '', ...rest] = Array.from(text);
  return first.toUpperCase() + rest.join('');
}

function pillText(plan: PublicPlan, state: DisplayState): string {
  if (state === 'not_this_time') return 'Not this time';
  return `Needs ${Math.max(plan.minimum - plan.names.length, 0)} more`;
}

function seats(plan: PublicPlan): HtmlEscapedString {
  const empty = Math.max(plan.minimum - plan.names.length, 0);
  const emptySeats = Array.from({ length: empty }, (_, i) =>
    i === 0
      ? html`<li class="seat"><span class="dot dot-empty" aria-hidden="true"></span>you?</li>`
      : html`<li class="seat"><span class="dot dot-empty" aria-hidden="true"></span></li>`,
  );
  return html`<ul class="seats" aria-label="${plan.names.length} of ${plan.minimum} people in">
    ${plan.names.map(
      (name) => html`<li class="seat"><span class="dot" aria-hidden="true"></span>${firstName(name)}</li>`,
    )}
    ${emptySeats}
  </ul>` as HtmlEscapedString;
}

export function publicPlanPage({ plan, state }: { plan: PublicPlan; state: DisplayState }): HtmlEscapedString {
  const body =
    state === 'not_this_time'
      ? html`<p>This one isn't going ahead. No harm done. Maybe next time.</p>
          <p><a href="/">Suggest a plan</a></p>`
      : html`${seats(plan)}
          <p>
            Goes ahead with a minimum of ${plan.minimum}. Decide by ${formatDeadline(plan.commitDeadlineAt)}.
          </p>`;
  return html`<main>
    <p class="pill">${pillText(plan, state)}</p>
    <p class="eyebrow">${capitalise(plan.format)}</p>
    <h1>${plan.venue}</h1>
    <p class="meta">${plan.city} · ${formatWhen(plan.gatheringAt)}</p>
    ${body}
  </main>` as HtmlEscapedString;
}

export function publicPlanOg(plan: PublicPlan, _state: DisplayState, baseUrl: string): LayoutOptions['og'] {
  const description = `${formatWhen(plan.gatheringAt)} · ${plan.city}. Goes ahead if ${plan.minimum} are in.`;
  return {
    title: `${capitalise(plan.format)} at ${plan.venue}`,
    description,
    image: `${baseUrl}/static/og.png`,
    siteName: 'calvin',
  };
}
