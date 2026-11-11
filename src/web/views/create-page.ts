import { brand } from './layout.ts';
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { CITIES } from '../../config.ts';
import type { FromPlan } from '../../domain/plans.ts';
import type { Suggestion } from '../../domain/suggestions.ts';
import { formatDeadline, formatWhen, localDateTime, localToInstant } from '../../domain/time.ts';

export type FormValues = Record<string, string>;
export type FieldErrors = Record<string, string>;

export type CreateState =
  | { kind: 'inputs'; values: FormValues; notice?: string; previousSuggestionId?: string }
  | { kind: 'card'; suggestion: Extract<Suggestion, { outcome: 'ok' }>; values: FormValues; notice?: string }
  | {
      kind: 'fallback';
      values: FormValues;
      notice?: string;
      city: string;
      area: string;
      timeWindow: string;
      previousSuggestionId?: string;
    }
  | { kind: 'again'; from: FromPlan; values: FormValues; notice?: string };

export const AGAIN_HEADING = 'Same again, new date';

export const SUGGEST_LIMIT_NOTICE = 'Lots of suggestions just now. Fill in your own below, or try again in a few minutes.';
export const PUBLISH_LIMIT_NOTICE = 'Lots of plans from here just now. Try again in a little while.';

export const FALLBACK_NOTICE =
  "We couldn't come up with a suggestion just now. Fill in your own below, or try again.";

type FieldOptions = { type?: string; autocomplete?: string; placeholder?: string };

export const LEDE = "Say roughly where and when. We'll suggest one specific plan you can share in your chat.";

export const DECIDE_BY_HELP = "Leave Decide by empty and we'll pick a sensible time.";

const CONTEXT_FIELDS =['city', 'area', 'timeWindow'] as const;

export function createPage(
  state: CreateState,
  errors: FieldErrors,
  cities: readonly string[] = CITIES,
): HtmlEscapedString {
  const { values } = state;
  const error = (field: string) =>
    errors[field] === undefined ? '' : html`<p class="error" id="${field}-error">${errors[field]}</p>`;
  const describedBy = (field: string) => (errors[field] === undefined ? '' : `${field}-error`);

  const input = (field: string, label: string, fallback = '', options: FieldOptions = {}) => {
    const type = options.type ?? 'text';
    const describe = describedBy(field);
    return html`<div class="field">
      <label for="${field}">${label}</label>
      <input
        id="${field}"
        type="${type}"
        name="${field}"
        value="${values[field] ?? fallback}"
        ${options.placeholder ? html`placeholder="${options.placeholder}"` : ''}
        ${options.autocomplete ? html`autocomplete="${options.autocomplete}"` : ''}
        ${describe ? html`aria-describedby="${describe}" aria-invalid="true"` : ''}
      />
      ${error(field)}
    </div>`;
  };

  const main = (body: HtmlEscapedString | Promise<HtmlEscapedString>) =>
    html`<main>
      ${brand}
      <h1>${state.kind === 'again' ? AGAIN_HEADING : 'Suggest a plan'}</h1>
      ${state.kind === 'inputs' ? html`<p class="lede">${LEDE}</p>` : ''}
      ${state.kind === 'inputs' && state.notice ? html`<p class="notice">${state.notice}</p>` : ''}
      ${body}
    </main>` as HtmlEscapedString;

  if (state.kind === 'inputs') {
    const describeCity = describedBy('city');
    return main(html`<form method="post" action="/suggest" data-suggest-form>
      ${state.previousSuggestionId !== undefined
        ? html`<input type="hidden" name="previousSuggestionId" value="${state.previousSuggestionId}" />`
        : ''}
      <div class="field">
        <label for="city">City</label>
        <select id="city" name="city" ${describeCity ? html`aria-describedby="${describeCity}" aria-invalid="true"` : ''}>
          <option value=""></option>
          ${cities.map((city) => html`<option value="${city}" ${values.city === city ? 'selected' : ''}>${city}</option>`)}
        </select>
        ${error('city')}
      </div>
      ${input('area', 'Rough area', '', { placeholder: 'e.g. Rockridge, near the BART' })}
      ${input('timeWindow', 'Rough time', '', { placeholder: 'e.g. Saturday morning' })}
      <button type="submit" class="btn btn-primary">Suggest a plan</button>
    </form>`);
  }

  const context =
    state.kind === 'card'
      ? { city: state.suggestion.city, area: state.suggestion.area, timeWindow: state.suggestion.timeWindow }
      : state.kind === 'again'
        ? { city: state.from.city, area: state.from.area, timeWindow: state.from.timeWindow }
        : { city: state.city, area: state.area, timeWindow: state.timeWindow };
  const prefill =
    state.kind === 'card'
      ? {
          format: state.suggestion.format,
          venue: state.suggestion.venue,
          ...localDateTime(state.suggestion.gatheringAt),
          minimum: String(state.suggestion.minimum),
          deadline: localDateTime(state.suggestion.commitDeadlineAt),
        }
      : state.kind === 'again'
        ? {
            format: state.from.format,
            venue: state.from.venue,
            date: '',
            time: '',
            minimum: String(state.from.minimum),
            deadline: { date: '', time: '' },
          }
        : { format: '', venue: '', date: '', time: '', minimum: '3', deadline: { date: '', time: '' } };
  const person = state.kind === 'again' ? { name: state.from.name, email: state.from.email } : { name: '', email: '' };
  const shown = (field: string, fallback: string) => (values[field] ?? fallback).trim();
  const instantOf = (date: string, time: string) =>
    DATE.test(date) && TIME.test(time) ? safely(() => localToInstant(date, time)) : undefined;
  const whenAt = instantOf(shown('date', prefill.date), shown('time', prefill.time));
  const decideAt = instantOf(shown('deadlineDate', prefill.deadline.date), shown('deadlineTime', prefill.deadline.time));
  const minimum = shown('minimum', prefill.minimum);
  const summaries: Record<string, string | undefined> = {
    where: shown('venue', prefill.venue) || undefined,
    when: whenAt && formatWhen(whenAt),
    minimum: /^\d+$/.test(minimum) ? `${Number(minimum)} people, you included` : undefined,
    decide: decideAt && formatDeadline(decideAt),
  };
  const row = (field: string, body: HtmlEscapedString | Promise<HtmlEscapedString>) =>
    html`<div class="row-field" data-field="${field}"${summaries[field] === undefined ? '' : html` data-summary="${summaries[field]}"`}>
      ${body}
    </div>`;
  const changeId =
    state.kind === 'card' ? state.suggestion.id : state.kind === 'again' ? undefined : state.previousSuggestionId;
  const empty = state.kind === 'fallback';
  const contextErrors =CONTEXT_FIELDS.filter((field) => errors[field] !== undefined);
  const hasContext = CONTEXT_FIELDS.some((field) => context[field] !== '');

  return main(html`${state.notice ? html`<p class="notice">${state.notice}</p>` : ''}
    ${hasContext
      ? html`<p class="summary">
          ${context.city} · ${context.area} · ${context.timeWindow}
          ${changeId !== undefined ? html`<a href="/?suggestion=${changeId}&change=1" class="quiet">Change</a>` : ''}
        </p>`
      : ''}
    ${contextErrors.length > 0
      ? html`<ul class="errors">
          ${contextErrors.map((field) => html`<li class="error" id="${field}-error">${errors[field]}</li>`)}
        </ul>`
      : ''}
    <form method="post" action="/plans" data-publish-form="${state.kind}">
      ${CONTEXT_FIELDS.map((field) => html`<input type="hidden" name="${field}" value="${context[field]}" />`)}
      ${state.kind === 'card' ? html`<input type="hidden" name="suggestionId" value="${state.suggestion.id}" />` : ''}
      ${state.kind === 'again' ? html`<input type="hidden" name="fromManageToken" value="${state.from.manageToken}" />` : ''}
      <div class="card">
      ${input('format', 'What', prefill.format, empty ? { placeholder: 'e.g. coffee, drinks, a walk' } : {})}
      ${row('where', input('venue', 'Where', prefill.venue, empty ? { placeholder: 'e.g. Blue Bottle, College Ave' } : {}))}
      ${row(
        'when',
        html`<div class="row">
          ${input('date', 'Date', prefill.date, { type: 'date' })} ${input('time', 'Time', prefill.time, { type: 'time' })}
        </div>`,
      )}
      ${row('minimum', input('minimum', 'Minimum, you included', prefill.minimum, { type: 'number' }))}
      ${row(
        'decide',
        html`<div class="row">
          ${input('deadlineDate', 'Decide by', prefill.deadline.date, { type: 'date' })}
          ${input('deadlineTime', 'Time', prefill.deadline.time, { type: 'time' })}
        </div>`,
      )}
      </div>
      ${empty ? html`<p class="help">${DECIDE_BY_HELP}</p>` : ''}
      <h2>You're the first one in</h2>
      ${input('name', 'Your name', person.name, { autocomplete: 'name' })}
      ${input('email', 'Your email', person.email, { type: 'email', autocomplete: 'email' })}
      <button type="submit" class="btn btn-primary">Publish plan</button>
    </form>
    ${state.kind === 'card' ? suggestAgain(context, state.suggestion.id, 'Suggest another') : ''}
    ${state.kind === 'fallback' ? suggestAgain(context, state.previousSuggestionId, 'Try suggesting again') : ''}`);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

/** The value, or undefined when it throws (an impossible date such as 2026-02-30). */
function safely<T>(make: () => T): T | undefined {
  try {
    return make();
  } catch {
    return undefined;
  }
}

type Context = { city: string; area: string; timeWindow: string };

/** A form beside the publish form that asks for another suggestion for the same city, area and time. */
function suggestAgain(context: Context, previousId: string | undefined, label: string): HtmlEscapedString {
  return html`<form method="post" action="/suggest" class="again" data-suggest-form>
    ${CONTEXT_FIELDS.map((field) => html`<input type="hidden" name="${field}" value="${context[field]}" />`)}
    ${previousId === undefined ? '' : html`<input type="hidden" name="previousSuggestionId" value="${previousId}" />`}
    <button type="submit" class="btn btn-secondary">${label}</button>
  </form>` as HtmlEscapedString;
}
