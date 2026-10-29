import { describe, expect, it } from 'vitest';
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { layout } from './layout.ts';

const body = html`<main>x</main>` as HtmlEscapedString;
const og = { title: 'Coffee at Blue Bottle', description: 'Sat 14 Nov · 10:00 AM · Oakland.', image: 'https://calvin.test/static/og.png', siteName: 'calvin' };

describe('layout', () => {
  it('emits the plan OG tags instead of the generic ones when noindex and og are given', () => {
    const page = String(layout('Plan', body, { noindex: true, og }));

    expect(page).toContain('<meta name="robots" content="noindex"');
    expect(page).toContain('<meta property="og:title" content="Coffee at Blue Bottle"');
    expect(page).toContain('<meta property="og:description" content="Sat 14 Nov · 10:00 AM · Oakland."');
    expect(page).toContain('<meta property="og:image" content="https://calvin.test/static/og.png"');
    expect(page).toContain('<meta property="og:site_name" content="calvin"');
    expect(page.match(/og:title/g)).toHaveLength(1);
  });
});
