import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export type FormValues = Record<string, string>;
export type FieldErrors = Record<string, string>;

const FIELDS = [
  'city',
  'area',
  'timeWindow',
  'format',
  'venue',
  'date',
  'time',
  'minimum',
  'deadlineDate',
  'deadlineTime',
  'name',
  'email',
];

// Stub: Task 7 replaces this with the real create page.
export function createPage(values: FormValues, errors: FieldErrors): HtmlEscapedString {
  return html`<main>
    <h1>Suggest a plan</h1>
    <form method="post" action="/plans">
      ${FIELDS.map(
        (field) => html`<p>
          <label>${field} <input name="${field}" value="${values[field] ?? ''}" /></label>
          ${errors[field] ? html`<span class="error">${errors[field]}</span>` : ''}
        </p>`,
      )}
      <button type="submit">Publish plan</button>
    </form>
  </main>` as HtmlEscapedString;
}
