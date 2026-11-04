import { brand } from './layout.ts';
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { DisplayState } from '../../domain/plan-rules.ts';
import type { PublicPlan } from '../../domain/plans.ts';
import { formatDay, formatDeadline, formatWhen } from '../../domain/time.ts';
import type { FieldErrors } from './create-page.ts';
import type { LayoutOptions } from './layout.ts';

const FIRST_NAME_MAX = 16;

export function firstName(fullName: string): string {
  const word = fullName.split(/\s+/).find((part) => part !== '') ?? '';
  return Array.from(word).slice(0, FIRST_NAME_MAX).join('');
}

export function capitalise(text: string): string {
  const [first = '', ...rest] = Array.from(text);
  return first.toUpperCase() + rest.join('');
}

function pillText(plan: PublicPlan, state: DisplayState): string {
  if (state === 'not_this_time') return 'Not this time';
  if (state === 'on') return "It's on";
  if (state === 'happening_now') return 'Happening now';
  if (state === 'was_on') return `This was on ${formatDay(plan.gatheringAt)}`;
  return `Needs ${Math.max(plan.minimum - plan.names.length, 0)} more`;
}

function filledSeats(plan: PublicPlan): HtmlEscapedString {
  return html`<ul class="seats" aria-label="${plan.names.length} people in">
    ${plan.names.map(
      (name) => html`<li class="seat"><span class="dot dot-on" aria-hidden="true"></span>${firstName(name)}</li>`,
    )}
  </ul>` as HtmlEscapedString;
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

export type CommitFormState = { values: { name?: string; email?: string }; errors: FieldErrors };

function commitForm(publicToken: string, form: CommitFormState | undefined): HtmlEscapedString {
  const values = form?.values ?? {};
  const errors = form?.errors ?? {};
  const error = (field: string) =>
    errors[field] === undefined ? '' : html`<p class="error" id="${field}-error">${errors[field]}</p>`;
  const invalid = (field: string) =>
    errors[field] === undefined ? '' : html`aria-describedby="${field}-error" aria-invalid="true"`;
  return html`<form method="post" action="/p/${publicToken}/commit" class="commit-form">
    <div class="field">
      <label for="name">Your name</label>
      <input id="name" type="text" name="name" value="${values.name ?? ''}" autocomplete="name" autocapitalize="words" ${invalid('name')} />
      ${error('name')}
    </div>
    <div class="field">
      <label for="email">Email</label>
      <input id="email" type="email" name="email" value="${values.email ?? ''}" inputmode="email" autocomplete="email" ${invalid('email')} />
      ${error('email')}
      <p class="help">Only used to tell you if it's on. Never shown to anyone.</p>
    </div>
    <button type="submit" class="btn btn-primary">I'm in</button>
  </form>` as HtmlEscapedString;
}

export type PublicNotice = { code: string; n?: string };

function noticeText(notice: PublicNotice): string | undefined {
  const n = notice.n === undefined ? '' : Array.from(notice.n).slice(0, FIRST_NAME_MAX).join('');
  if (notice.code === 'in') return n ? `You're in, ${n}. We'll email you if it's on.` : "You're in. We'll email you if it's on.";
  if (notice.code === 'on') {
    const tail = "It's on! We've emailed you the details and we'll remind you the day before.";
    return n ? `You're in, ${n}. ${tail}` : `You're in. ${tail}`;
  }
  if (notice.code === 'updated') return n ? `Updated: you're in as ${n}.` : "Updated: you're in.";
  if (notice.code === 'closed') return "This one isn't taking commits any more.";
  return undefined;
}

export function publicPlanPage({
  plan,
  state,
  publicToken,
  notice,
  form,
}: {
  plan: PublicPlan;
  state: DisplayState;
  publicToken: string;
  notice?: PublicNotice;
  form?: CommitFormState;
}): HtmlEscapedString {
  const noticeCopy = notice === undefined ? undefined : noticeText(notice);
  const replacesForm = notice?.code === 'in' || notice?.code === 'updated' || notice?.code === 'on';
  const body =
    state === 'not_this_time'
      ? html`<p>This one isn't going ahead. No harm done. Maybe next time.</p>
          <p><a href="/">Suggest a plan</a></p>`
      : state === 'happening_now' || state === 'was_on'
        ? filledSeats(plan)
        : state === 'on'
          ? html`${filledSeats(plan)}
          <p>More people are welcome until it starts.</p>`
        : html`${seats(plan)}
          <p>
            Goes ahead with a minimum of ${plan.minimum}. Decide by ${formatDeadline(plan.commitDeadlineAt)}.
          </p>`;
  return html`<main>
    ${brand}
    <p class="pill">${pillText(plan, state)}</p>
    <p class="eyebrow">${capitalise(plan.format)}</p>
    <h1>${plan.venue}</h1>
    <p class="meta">${plan.city} · ${formatWhen(plan.gatheringAt)}</p>
    ${body}
    ${noticeCopy === undefined ? '' : html`<p class="${notice?.code === 'on' ? 'notice notice-on' : 'notice'}" role="status">${noticeCopy}</p>`}
    ${state === 'not_this_time' || state === 'happening_now' || state === 'was_on' || replacesForm ? '' : commitForm(publicToken, form)}
  </main>` as HtmlEscapedString;
}

export function publicPlanOg(plan: PublicPlan, state: DisplayState, baseUrl: string): LayoutOptions['og'] {
  const itsOn = state === 'on' ? " It's on." : '';
  const description = `${formatWhen(plan.gatheringAt)} · ${plan.city}. Goes ahead if ${plan.minimum} are in.${itsOn}`;
  return {
    title: `${capitalise(plan.format)} at ${plan.venue}`,
    description,
    image: `${baseUrl}/static/og.png`,
    siteName: 'calvin',
  };
}
