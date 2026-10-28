import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export type LayoutOptions = { noindex?: boolean };

export function layout(title: string, body: HtmlEscapedString, options: LayoutOptions = {}): HtmlEscapedString {
  const head = options.noindex
    ? html`<meta name="robots" content="noindex" />
        <meta property="og:title" content="Calvin" />
        <meta property="og:description" content="Get something on the calendar with people nearby." />`
    : '';
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        ${head}
      </head>
      <body>
        ${body}
      </body>
    </html>` as HtmlEscapedString;
}
