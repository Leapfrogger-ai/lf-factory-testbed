import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export type PublishedLinks = { publicLink: string; manageLink: string; emailed: boolean };

const emailedCopy = html`<p>We've emailed you a private link to manage the plan. Keep it to yourself.</p>`;
const notEmailedCopy = html`<p>We couldn't email you your private link. Bookmark the link below to manage the plan.</p>`;

export function publishedPage({ publicLink, manageLink, emailed }: PublishedLinks): HtmlEscapedString {
  return html`<main>
    <h1>Your plan is ready to share</h1>
    <p>
      <input type="text" readonly aria-label="Link to share" value="${publicLink}" />
      <button type="button">Copy</button>
    </p>
    ${emailed ? emailedCopy : notEmailedCopy}
    <p><a href="${manageLink}">Manage your plan</a></p>
  </main>` as HtmlEscapedString;
}
