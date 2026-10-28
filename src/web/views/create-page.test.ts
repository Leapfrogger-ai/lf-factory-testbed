import { describe, expect, it } from 'vitest';
import { CITIES } from '../../config.ts';
import { createPage } from './create-page.ts';

const render = (values: Record<string, string>, errors: Record<string, string>) => String(createPage(values, errors));

describe('createPage', () => {
  it('renders the cities in order after an unselected blank option', () => {
    const body = render({}, {});
    const options = [...body.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)];

    expect(options.map((m) => m[2])).toEqual(['', ...CITIES]);
    expect(options.some((m) => /selected/.test(m[1] ?? ''))).toBe(false);
  });

  it('defaults the minimum to 3 and leaves Decide by empty', () => {
    const body = render({}, {});

    expect(body).toMatch(/<input[^>]*name="minimum"[^>]*value="3"/);
    expect(body).toMatch(/<input[^>]*type="date"[^>]*name="deadlineDate"[^>]*value=""/);
    expect(body).toMatch(/<input[^>]*type="time"[^>]*name="deadlineTime"[^>]*value=""/);
    expect(body).toContain('Decide by');
  });

  it('posts the first-one-in form to /plans with a Publish plan button', () => {
    const body = render({}, {});

    expect(body).toContain('<form method="post" action="/plans"');
    expect(body).toContain("You're the first one in");
    expect(body).toMatch(/<button[^>]*type="submit"[^>]*>Publish plan<\/button>/);
    expect(body).toMatch(/<input[^>]*type="date"[^>]*name="date"/);
    expect(body).toMatch(/<input[^>]*type="time"[^>]*name="time"/);
    expect(body).toMatch(/<input[^>]*type="email"[^>]*name="email"/);
  });

  it('escapes entered values', () => {
    const body = render({ name: '<b>' }, {});

    expect(body).toContain('value="&lt;b&gt;"');
    expect(body).not.toContain('<b>');
  });

  it('keeps the chosen city selected on re-render', () => {
    const body = render({ city: 'Oakland' }, {});

    expect(body).toMatch(/<option[^>]*selected[^>]*>Oakland<\/option>/);
  });

  it('shows a field error under its field, linked with aria-describedby', () => {
    const body = render({}, { name: 'Add your name.' });

    expect(body).toContain('Add your name.');
    expect(body).toMatch(/<input[^>]*name="name"[^>]*aria-describedby="name-error"/);
    expect(body).toMatch(/id="name-error"[^>]*>Add your name\.</);
  });
});
