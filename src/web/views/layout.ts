import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export function layout(title: string, body: HtmlEscapedString): HtmlEscapedString {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
      </head>
      <body>
        ${body}
      </body>
    </html>` as HtmlEscapedString;
}
