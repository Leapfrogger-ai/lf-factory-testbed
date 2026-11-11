import { brand } from './layout.ts';
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export type PublishedLinks = {
  publicLink: string;
  manageLink: string;
  manageUrl: string;
  emailed: boolean;
  shareText: string;
};

const emailedCopy = html`<p class="meta">We've emailed you a private link to manage the plan. Keep it to yourself.</p>`;
const notEmailedCopy = html`<p>We couldn't email you your private link. Copy it now and keep it somewhere safe: it's the only way to manage the plan.</p>`;

export function publishedPage({ publicLink, manageLink, manageUrl, emailed, shareText }: PublishedLinks): HtmlEscapedString {
  const manageBox = html`${notEmailedCopy}
    <label for="manage-link">Your private link</label>
    <div class="linkbox">
      <input type="text" id="manage-link" readonly aria-label="Your private link" value="${manageUrl}" />
      <button type="button" id="copy-manage" class="btn btn-secondary" data-copy="manage-link">Copy</button>
    </div>`;
  const emailedLink = html`${emailedCopy}
    <p><a class="quiet" href="${manageLink}">Manage your plan</a></p>`;
  return html`<main>
    ${brand}
    <h1>Your plan is ready to share</h1>
    <label for="public-link">Link to share</label>
    <div class="linkbox">
      <input type="text" id="public-link" readonly aria-label="Link to share" value="${publicLink}" />
      <button type="button" id="copy" class="btn btn-primary" data-copy="public-link">Copy</button>
    </div>
    <button type="button" id="share" class="btn btn-secondary" hidden data-share-text="${shareText}">Share…</button>
    <p id="copy-status" aria-live="polite"></p>
    ${emailed ? emailedLink : manageBox}
  </main>` as HtmlEscapedString;
}
