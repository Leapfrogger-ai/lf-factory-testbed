import { brand } from './layout.ts';
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { WithdrawTarget } from '../../domain/plans.ts';
import { formatDay } from '../../domain/time.ts';
import { capitalise } from './public-plan-page.ts';

const onward = html`<p><a class="quiet" href="/">Suggest a plan</a></p>`;

export function withdrawPage({
  target,
  token,
  now,
}: {
  target: WithdrawTarget;
  token: string;
  now: Temporal.Instant;
}): HtmlEscapedString {
  if (target.state === 'called_off') {
    return html`<main>
    ${brand}
    <h1>This one isn't going ahead, so there's nothing to withdraw from.</h1>
    ${onward}
  </main>` as HtmlEscapedString;
  }
  if (Temporal.Instant.compare(now, target.gatheringAt) >= 0) {
    return html`<main>
    ${brand}
    <h1>This one has already started.</h1>
    ${onward}
  </main>` as HtmlEscapedString;
  }
  if (target.withdrawn) {
    return html`<main>
    ${brand}
    <h1>You're out</h1>
    <p class="copy">You've withdrawn from ${capitalise(target.format)} on ${formatDay(target.gatheringAt)}. No more emails about it.</p>
    ${onward}
  </main>` as HtmlEscapedString;
  }
  return html`<main>
    ${brand}
    <h1>Withdraw from ${capitalise(target.format)} at ${target.venue} on ${formatDay(target.gatheringAt)}?</h1>
    <form method="post" action="/w/${token}">
      <button type="submit" class="btn btn-primary">Withdraw</button>
    </form>
  </main>` as HtmlEscapedString;
}
