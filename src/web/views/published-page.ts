import { brand } from './layout.ts';
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export type PublishedLinks = { publicLink: string; manageLink: string; emailed: boolean; shareText: string };

const emailedCopy = html`<p class="meta">We've emailed you a private link to manage the plan. Keep it to yourself.</p>`;
const notEmailedCopy = html`<p>We couldn't email you your private link. Bookmark the link below to manage the plan.</p>`;

export function publishedPage({ publicLink, manageLink, emailed, shareText }: PublishedLinks): HtmlEscapedString {
  return html`<main>
    ${brand}
    <h1>Your plan is ready to share</h1>
    <label for="public-link">Link to share</label>
    <div class="linkbox">
      <input type="text" id="public-link" readonly aria-label="Link to share" value="${publicLink}" />
      <button type="button" id="copy" class="btn btn-primary">Copy</button>
    </div>
    <button type="button" id="share" class="btn btn-secondary" hidden data-share-text="${shareText}">Share…</button>
    <p id="copy-status" aria-live="polite"></p>
    ${emailed ? emailedCopy : notEmailedCopy}
    <p><a class="quiet" href="${manageLink}">Manage your plan</a></p>
  </main>` as HtmlEscapedString;
}
