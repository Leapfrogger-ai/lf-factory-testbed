import { describe, expect, it } from 'vitest';
import { notFoundPage } from './not-found-page.ts';
import { systemErrorPage } from './system-error-page.ts';

describe('not-found and error pages', () => {
  it('gives the Suggest a plan link class quiet', () => {
    expect(String(notFoundPage())).toContain('<a class="quiet" href="/">Suggest a plan</a>');
  });

  it('gives the Start over link class quiet', () => {
    expect(String(systemErrorPage())).toContain('<a class="quiet" href="/">Start over</a>');
  });

  it('says what happened on the system error page', () => {
    expect(String(systemErrorPage())).toMatch(
      /<h1>Something went wrong<\/h1>\s*<p>That didn't go through on our side\. Go back and try again in a minute\.<\/p>\s*<p><a class="quiet" href="\/">Start over<\/a><\/p>/,
    );
  });
});
