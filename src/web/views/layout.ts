import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export type LayoutOptions = {
  noindex?: boolean;
  og?: { title: string; description: string; image: string; siteName: string };
};

export function layout(title: string, body: HtmlEscapedString, options: LayoutOptions = {}): HtmlEscapedString {
  const { og } = options;
  const ogTags = og
    ? html`<meta property="og:title" content="${og.title}" />
        <meta property="og:description" content="${og.description}" />
        <meta property="og:image" content="${og.image}" />
        <meta property="og:site_name" content="${og.siteName}" />`
    : html`<meta property="og:title" content="Calvin" />
        <meta property="og:description" content="Get something on the calendar with people nearby." />`;
  const head = options.noindex ? html`<meta name="robots" content="noindex" />${ogTags}` : '';
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        <link rel="stylesheet" href="/static/app.css" />
        ${head}
      </head>
      <body>
        ${body}
      </body>
    </html>` as HtmlEscapedString;
}
