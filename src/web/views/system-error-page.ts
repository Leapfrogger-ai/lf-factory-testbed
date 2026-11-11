import { brand } from './layout.ts';
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export function systemErrorPage(): HtmlEscapedString {
  return html`<main>
    ${brand}
    <h1>Something went wrong</h1>
    <p>That didn't go through on our side. Go back and try again in a minute.</p>
    <p><a class="quiet" href="/">Start over</a></p>
  </main>` as HtmlEscapedString;
}
