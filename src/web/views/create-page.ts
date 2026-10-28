import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { CITIES } from '../../config.ts';

export type FormValues = Record<string, string>;
export type FieldErrors = Record<string, string>;

type FieldOptions = { type?: string; autocomplete?: string; extra?: string };

export function createPage(
  values: FormValues,
  errors: FieldErrors,
  cities: readonly string[] = CITIES,
): HtmlEscapedString {
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

  const describeCity = describedBy('city');
  return html`<main>
    <p class="brand">calvin</p>
    <h1>Suggest a plan</h1>
    <form method="post" action="/plans">
      <div class="field">
        <label for="city">City</label>
        <select id="city" name="city" ${describeCity ? html`aria-describedby="${describeCity}" aria-invalid="true"` : ''}>
          <option value=""></option>
          ${cities.map((city) => html`<option value="${city}" ${values.city === city ? 'selected' : ''}>${city}</option>`)}
        </select>
        ${error('city')}
      </div>
      ${input('area', 'Rough area')} ${input('timeWindow', 'Rough time')} ${input('format', 'What')}
      ${input('venue', 'Where')}
      <div class="row">${input('date', 'Date', '', { type: 'date' })} ${input('time', 'Time', '', { type: 'time' })}</div>
      ${input('minimum', 'Minimum, you included', '3', { type: 'number' })}
      <div class="row">
        ${input('deadlineDate', 'Decide by', '', { type: 'date' })} ${input('deadlineTime', 'Time', '', { type: 'time' })}
      </div>
      <h2>You're the first one in</h2>
      ${input('name', 'Your name', '', { autocomplete: 'name' })}
      ${input('email', 'Your email', '', { type: 'email', autocomplete: 'email' })}
      <button type="submit" class="btn btn-primary">Publish plan</button>
    </form>
  </main>` as HtmlEscapedString;
}
