import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { CITIES } from '../../config.ts';
import type { Suggestion } from '../../domain/suggestions.ts';
import { localDateTime } from '../../domain/time.ts';

export type FormValues = Record<string, string>;
export type FieldErrors = Record<string, string>;

export type CreateState =
  | { kind: 'inputs'; values: FormValues; previousSuggestionId?: string }
  | { kind: 'card'; suggestion: Extract<Suggestion, { outcome: 'ok' }>; values: FormValues }
  | {
      kind: 'fallback';
      values: FormValues;
      notice?: string;
      city: string;
      area: string;
      timeWindow: string;
      previousSuggestionId?: string;
    };

export const FALLBACK_NOTICE =
  "We couldn't come up with a suggestion just now. Fill in your own below, or try again.";

type FieldOptions = { type?: string; autocomplete?: string };

const CONTEXT_FIELDS = ['city', 'area', 'timeWindow'] as const;

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
        ${options.autocomplete ? html`autocomplete="${options.autocomplete}"` : ''}
        ${describe ? html`aria-describedby="${describe}" aria-invalid="true"` : ''}
      />
      ${error(field)}
    </div>`;
  };

  const main = (body: HtmlEscapedString | Promise<HtmlEscapedString>) =>
    html`<main>
      <p class="brand">calvin</p>
      <h1>Suggest a plan</h1>
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
      ${input('area', 'Rough area')} ${input('timeWindow', 'Rough time')}
      <button type="submit" class="btn btn-primary">Suggest a plan</button>
    </form>`);
  }

  const context =
    state.kind === 'card'
      ? { city: state.suggestion.city, area: state.suggestion.area, timeWindow: state.suggestion.timeWindow }
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
      : { format: '', venue: '', date: '', time: '', minimum: '3', deadline: { date: '', time: '' } };
  const contextErrors = CONTEXT_FIELDS.filter((field) => errors[field] !== undefined);
  const hasContext = CONTEXT_FIELDS.some((field) => context[field] !== '');

  return main(html`${state.kind === 'fallback' && state.notice ? html`<p class="notice">${state.notice}</p>` : ''}
    ${hasContext
      ? html`<p class="summary">
          ${context.city} · ${context.area} · ${context.timeWindow}
          ${state.kind === 'card'
            ? html`<a href="/?suggestion=${state.suggestion.id}&change=1">Change</a>`
            : ''}
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
      ${input('format', 'What', prefill.format)}
      <div class="row-field" data-field="where">${input('venue', 'Where', prefill.venue)}</div>
      <div class="row-field" data-field="when">
        <div class="row">
          ${input('date', 'Date', prefill.date, { type: 'date' })} ${input('time', 'Time', prefill.time, { type: 'time' })}
        </div>
      </div>
      <div class="row-field" data-field="minimum">
        ${input('minimum', 'Minimum, you included', prefill.minimum, { type: 'number' })}
      </div>
      <div class="row-field" data-field="decide">
        <div class="row">
          ${input('deadlineDate', 'Decide by', prefill.deadline.date, { type: 'date' })}
          ${input('deadlineTime', 'Time', prefill.deadline.time, { type: 'time' })}
        </div>
      </div>
      <h2>You're the first one in</h2>
      ${input('name', 'Your name', '', { autocomplete: 'name' })}
      ${input('email', 'Your email', '', { type: 'email', autocomplete: 'email' })}
      <button type="submit" class="btn btn-primary">Publish plan</button>
    </form>
    ${state.kind === 'card' ? suggestAgain(context, state.suggestion.id, 'Suggest another') : ''}
    ${state.kind === 'fallback' && state.previousSuggestionId !== undefined
      ? suggestAgain(context, state.previousSuggestionId, 'Try suggesting again')
      : ''}`);
}

type Context = { city: string; area: string; timeWindow: string };

/** A form beside the publish form that asks for another suggestion for the same city, area and time. */
function suggestAgain(context: Context, previousId: string, label: string): HtmlEscapedString {
  return html`<form method="post" action="/suggest" data-suggest-form>
    ${CONTEXT_FIELDS.map((field) => html`<input type="hidden" name="${field}" value="${context[field]}" />`)}
    <input type="hidden" name="previousSuggestionId" value="${previousId}" />
    <button type="submit" class="btn">${label}</button>
  </form>` as HtmlEscapedString;
}
