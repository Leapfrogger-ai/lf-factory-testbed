import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export function notFoundPage(): HtmlEscapedString {
  return html`<main>
    <h1>Plan not found</h1>
    <p>We can't find that plan. The link may be incomplete. Check it in your chat or email.</p>
    <p><a href="/">Suggest a plan</a></p>
  </main>` as HtmlEscapedString;
}
