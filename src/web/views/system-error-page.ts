import { brand } from './layout.ts';
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export function systemErrorPage(): HtmlEscapedString {
  return html`<main>
    ${brand}
    <h1>Something went wrong</h1>
    <p>Something went wrong. Go back and try again.</p>
    <p><a class="quiet" href="/">Start over</a></p>
  </main>` as HtmlEscapedString;
}
