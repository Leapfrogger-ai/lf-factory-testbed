import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { DisplayState } from '../../domain/plan-rules.ts';
import type { ManagePlan } from '../../domain/plans.ts';
import { formatDeadline, formatWhen } from '../../domain/time.ts';
import { brand } from './layout.ts';
import { capitalise, initial, pillClass, pillText } from './public-plan-page.ts';

function name(fullName: string): HtmlEscapedString {
  return html`<li><span class="token" aria-hidden="true">${initial(fullName)}</span>${fullName}</li>` as HtmlEscapedString;
}

function confirm(manage: string): HtmlEscapedString {
  return html`<details class="calloff"><summary class="quiet">Call it off</summary>
    <div class="confirm">
      <p>Call it off? Everyone who's in gets a short "not this time" email.</p>
      <div class="row">
        <a class="quiet" href="${manage}">Keep it</a>
        <form method="post" action="${manage}/call-off"><button class="btn btn-dim" type="submit">Call it off</button></form>
      </div>
    </div>
  </details>` as HtmlEscapedString;
}

const tooLate = html`<p class="notice" role="status">It's already started, so it can't be called off.</p>`;

export function managePage({
  plan,
  state,
  publicLink,
  now,
  notice,
}: {
  plan: ManagePlan;
  state: DisplayState;
  publicLink: string;
  now: Temporal.Instant;
  notice?: 'too-late';
}): HtmlEscapedString {
  const calledOff = state === 'not_this_time' || state === 'was_on';
  const pill =
    state === 'needs_more'
      ? `${pillText(plan, state)} · decide by ${formatDeadline(plan.commitDeadlineAt)}`
      : pillText(plan, state);
  const manage = `/m/${plan.manageToken}`;
  const canCallOff =
    (state === 'needs_more' || state === 'on') && Temporal.Instant.compare(now, plan.gatheringAt) < 0;
  const namesClass = calledOff
    ? 'names names-off'
    : state === 'on' || state === 'happening_now'
      ? 'names names-on'
      : 'names';
  const namesLabel = calledOff ? 'Who was in' : "Who's in";
  const count = state === 'not_this_time' ? '' : html`<p class="count">${plan.names.length} of ${plan.minimum}</p>`;
  const emptySeat = state === 'needs_more' ? html`<li class="seat-empty" aria-hidden="true"><span class="token"></span></li>` : '';
  const linkBox = state === 'not_this_time'
    ? ''
    : html`<label for="public-link">Link to share</label>
    <div class="linkbox"><input id="public-link" type="text" readonly value="${publicLink}" /><button class="btn btn-primary" id="copy" type="button" data-copy="public-link">Copy</button></div>
    <p id="copy-status" aria-live="polite"></p>`;
  const startAgain = html`<a class="${state === 'not_this_time' ? 'btn btn-primary' : 'btn btn-secondary'}" href="${manage}/new">Start a new plan from this</a>`;
  const actions =
    state === 'not_this_time'
      ? startAgain
      : html`<div class="stack">
      ${startAgain}
      ${canCallOff ? confirm(manage) : ''}
    </div>`;
  return html`<main>
    <p class="private">Your plan. Only you can see this page.</p>
    ${brand}
    ${notice === 'too-late' ? tooLate : ''}
    <p class="pill ${pillClass(state)}">${pill}</p>
    <p class="kind">${capitalise(plan.format)}</p>
    <h1 class="${state === 'not_this_time' ? 'venue venue-off' : 'venue'}">${plan.venue}</h1>
    <p class="when">${formatWhen(plan.gatheringAt)}</p>
    <p class="where">${plan.city}</p>
    ${count}
    <ul class="${namesClass}" aria-label="${namesLabel}">
      ${plan.names.map(name)}
      ${emptySeat}
    </ul>
    ${linkBox}
    ${actions}
  </main>` as HtmlEscapedString;
}
