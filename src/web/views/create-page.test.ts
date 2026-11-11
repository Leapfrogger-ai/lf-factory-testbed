import { describe, expect, it } from 'vitest';
import { CITIES } from '../../config.ts';
import type { FromPlan } from '../../domain/plans.ts';
import type { Suggestion } from '../../domain/suggestions.ts';
import { createPage, type CreateState } from './create-page.ts';

const render = (state: CreateState, errors: Record<string, string> = {}) => String(createPage(state, errors));

const okSuggestion: Extract<Suggestion, { outcome: 'ok' }> = {
  id: '11111111-1111-4111-8111-111111111111',
  city: 'Oakland',
  area: 'Rockridge',
  timeWindow: 'next weekend, morning',
  outcome: 'ok',
  format: 'coffee',
  venue: 'Highwire Coffee Roasters',
  gatheringAt: Temporal.Instant.from('2026-11-14T18:00:00Z'),
  minimum: 3,
  commitDeadlineAt: Temporal.Instant.from('2026-11-12T06:00:00Z'),
};

const card = (values: Record<string, string> = {}): CreateState => ({ kind: 'card', suggestion: okSuggestion, values });

const NOTICE = "We couldn't come up with a suggestion just now. Fill in your own below, or try again.";

const fallback = (
  values: Record<string, string> = {},
  notice?: string,
): Extract<CreateState, { kind: 'fallback' }> => ({
  kind: 'fallback',
  values,
  notice,
  city: 'Oakland',
  area: 'Rockridge',
  timeWindow: 'next weekend, morning',
});

describe('createPage inputs state', () => {
  it('renders the lede after the h1, with the area and time placeholders', () => {
    const body = render({ kind: 'inputs', values: {} });

    const lede =
      '<p class="lede">Say roughly where and when. We&#39;ll suggest one specific plan you can share in your chat.</p>';
    expect(body).toContain(lede);
    expect(body.indexOf(lede)).toBeGreaterThan(body.indexOf('</h1>'));
    expect(body.match(/<input[^>]*name="area"[^>]*>/)?.[0]).toContain('placeholder="e.g. Rockridge, near the BART"');
    expect(body.match(/<input[^>]*name="timeWindow"[^>]*>/)?.[0]).toContain('placeholder="e.g. Saturday morning"');
  });

  it('keeps one lede when the inputs form has errors', () => {
    const body = render({ kind: 'inputs', values: {} }, { area: 'Add a rough area.' });

    expect(body.match(/class="lede"/g)).toHaveLength(1);
  });

  it('has no lede on the card, the fallback or the again page', () => {
    for (const body of [render(card()), render(fallback()), render(again())]) {
      expect(body).not.toContain('class="lede"');
    }
  });

  it('renders the cities in order after an unselected blank option', () => {
    const body = render({ kind: 'inputs', values: {} });
    const options = [...body.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)];

    expect(options.map((m) => m[2])).toEqual(['', ...CITIES]);
    expect(options.some((m) => /selected/.test(m[1] ?? ''))).toBe(false);
  });

  it('posts the suggest form to /suggest with a Suggest a plan button and no publish fields', () => {
    const body = render({ kind: 'inputs', values: {} });

    expect(body).toContain('<form method="post" action="/suggest"');
    expect(body).toMatch(/<button[^>]*type="submit"[^>]*>Suggest a plan<\/button>/);
    expect(body).toMatch(/<input[^>]*name="area"/);
    expect(body).toMatch(/<input[^>]*name="timeWindow"/);
    expect(body).not.toContain('Publish plan');
    expect(body).not.toContain('name="venue"');
  });

  it('keeps the chosen city selected and the entered values on re-render', () => {
    const body = render({ kind: 'inputs', values: { city: 'Oakland', area: 'Rockridge' } });

    expect(body).toMatch(/<option[^>]*selected[^>]*>Oakland<\/option>/);
    expect(body).toMatch(/<input[^>]*name="area"[^>]*value="Rockridge"/);
  });

  it('shows a field error under its field, linked with aria-describedby', () => {
    const body = render({ kind: 'inputs', values: {} }, { area: 'Add a rough area.', city: 'Pick a city.' });

    expect(body).toMatch(/<input[^>]*name="area"[^>]*aria-describedby="area-error"/);
    expect(body).toMatch(/id="area-error"[^>]*>Add a rough area\.</);
    expect(body).toMatch(/<select[^>]*aria-describedby="city-error"/);
    expect(body).toMatch(/id="city-error"[^>]*>Pick a city\.</);
  });

  it('escapes entered values', () => {
    const body = render({ kind: 'inputs', values: { area: '<b>' } });

    expect(body).toContain('value="&lt;b&gt;"');
    expect(body).not.toContain('<b>');
  });
});

describe('createPage card state', () => {
  it('shows the summary line and the card rows prefilled from the suggestion', () => {
    const body = render(card());

    expect(body).toContain('Oakland · Rockridge · next weekend, morning');
    expect(body).toMatch(/<input[^>]*name="format"[^>]*value="coffee"/);
    expect(body).toMatch(/<input[^>]*name="venue"[^>]*value="Highwire Coffee Roasters"/);
    expect(body).toMatch(/<input[^>]*type="date"[^>]*name="date"[^>]*value="2026-11-14"/);
    expect(body).toMatch(/<input[^>]*type="time"[^>]*name="time"[^>]*value="10:00"/);
    expect(body).toMatch(/<input[^>]*name="minimum"[^>]*value="3"/);
    expect(body).toMatch(/<input[^>]*type="date"[^>]*name="deadlineDate"[^>]*value="2026-11-11"/);
    expect(body).toMatch(/<input[^>]*type="time"[^>]*name="deadlineTime"[^>]*value="22:00"/);
  });

  it('posts the first-one-in form to /plans with hidden context and a Publish plan button', () => {
    const body = render(card());

    expect(body).toContain('<form method="post" action="/plans"');
    expect(body).toContain("You're the first one in");
    expect(body).toMatch(/<button[^>]*type="submit"[^>]*>Publish plan<\/button>/);
    expect(body).toMatch(/<input[^>]*type="email"[^>]*name="email"/);
    expect(body).toMatch(/<input[^>]*type="hidden"[^>]*name="city"[^>]*value="Oakland"/);
    expect(body).toMatch(/<input[^>]*type="hidden"[^>]*name="area"[^>]*value="Rockridge"/);
    expect(body).toMatch(/<input[^>]*type="hidden"[^>]*name="timeWindow"[^>]*value="next weekend, morning"/);
    expect(body).toMatch(
      /<input[^>]*type="hidden"[^>]*name="suggestionId"[^>]*value="11111111-1111-4111-8111-111111111111"/,
    );
  });

  it('keeps the entered values over the suggestion on a re-render', () => {
    const body = render(card({ venue: 'Somewhere else', name: 'Ann' }));

    expect(body).toMatch(/<input[^>]*name="venue"[^>]*value="Somewhere else"/);
    expect(body).toMatch(/<input[^>]*name="name"[^>]*value="Ann"/);
  });

  it('escapes the venue', () => {
    const body = render({ kind: 'card', suggestion: { ...okSuggestion, venue: '<script>x</script>' }, values: {} });

    expect(body).toContain('&lt;script&gt;');
    expect(body).not.toContain('<script>x');
  });

  it('shows a field error under its field, linked with aria-describedby', () => {
    const body = render(card(), { name: 'Add your name.' });

    expect(body).toMatch(/<input[^>]*name="name"[^>]*aria-describedby="name-error"/);
    expect(body).toMatch(/id="name-error"[^>]*>Add your name\.</);
  });

  it('lists errors on the hidden city, area and time under the summary line', () => {
    const body = render(card(), { city: 'Pick a city.', timeWindow: 'Add a rough time.' });

    expect(body).toMatch(/<ul[^>]*class="errors"[^>]*>[\s\S]*Pick a city\.[\s\S]*Add a rough time\.[\s\S]*<\/ul>/);
  });
});

describe('createPage fallback state', () => {
  it('shows the notice, the summary and empty rows with a minimum of 3', () => {
    const body = render(fallback({}, NOTICE));

    expect(body).toContain(
      "We couldn&#39;t come up with a suggestion just now. Fill in your own below, or try again.",
    );
    expect(body).toContain('Oakland · Rockridge · next weekend, morning');
    for (const field of ['format', 'venue', 'date', 'time', 'deadlineDate', 'deadlineTime']) {
      expect(body).toMatch(new RegExp(`<input[^>]*name="${field}"[^>]*value=""`));
    }
    expect(body).toMatch(/<input[^>]*name="minimum"[^>]*value="3"/);
    expect(body).toMatch(/<button[^>]*type="submit"[^>]*>Publish plan<\/button>/);
  });

  it('has no suggestionId and carries the hidden city, area and time', () => {
    const body = render(fallback());

    expect(body).not.toContain('name="suggestionId"');
    expect(body).toMatch(/<input[^>]*type="hidden"[^>]*name="city"[^>]*value="Oakland"/);
  });

  it('keeps entered values and leaves out the notice when it is not given', () => {
    const body = render(fallback({ venue: 'Blue Bottle' }));

    expect(body).toMatch(/<input[^>]*name="venue"[^>]*value="Blue Bottle"/);
    expect(body).not.toContain('come up with a suggestion');
  });
});

const ID = '11111111-1111-4111-8111-111111111111';

function suggestAgainForm(body: string): string {
  return body.match(/<form method="post" action="\/suggest"[\s\S]*?<\/form>/)?.[0] ?? '';
}

function hidden(form: string, name: string): string | undefined {
  return form.match(new RegExp('<input[^>]*name="' + name + '"[^>]*value="([^"]*)"'))?.[1];
}

describe('createPage card state suggest another and change', () => {
  it('links Change back to the inputs prefilled from this suggestion', () => {
    const body = render(card());

    expect(body).toMatch(new RegExp('<a href="/\\?suggestion=' + ID + '&(amp;)?change=1"[^>]*>Change</a>'));
  });

  it('posts the context and this suggestion to /suggest as Suggest another, outside the publish form', () => {
    const body = render(card());
    const form = suggestAgainForm(body);

    expect(form).toContain('Suggest another');
    expect(hidden(form, 'previousSuggestionId')).toBe(ID);
    expect(hidden(form, 'city')).toBe('Oakland');
    expect(hidden(form, 'area')).toBe('Rockridge');
    expect(hidden(form, 'timeWindow')).toBe('next weekend, morning');
    const publish = body.match(/<form method="post" action="\/plans"[\s\S]*?<\/form>/)?.[0] ?? '';
    expect(publish).not.toContain('Suggest another');
  });

  it('shows Try suggesting again on a fallback that has a previous suggestion', () => {
    const form = suggestAgainForm(render({ ...fallback({}, NOTICE), previousSuggestionId: ID }));

    expect(form).toContain('Try suggesting again');
    expect(hidden(form, 'previousSuggestionId')).toBe(ID);
    expect(hidden(form, 'city')).toBe('Oakland');
    expect(hidden(form, 'area')).toBe('Rockridge');
    expect(hidden(form, 'timeWindow')).toBe('next weekend, morning');
  });

  it('shows no Try suggesting again on a fallback without a previous suggestion', () => {
    const body = render(fallback({}, NOTICE));

    expect(body).not.toContain('Try suggesting again');
    expect(suggestAgainForm(body)).toBe('');
  });

  it('links Change on a fallback back to the inputs prefilled from the previous suggestion', () => {
    const body = render({ ...fallback({}, NOTICE), previousSuggestionId: ID });

    expect(body).toMatch(new RegExp('<a href="/\\?suggestion=' + ID + '&(amp;)?change=1"[^>]*>Change</a>'));
  });

  it('has no Change link on a fallback without a previous suggestion', () => {
    expect(render(fallback({}, NOTICE))).not.toContain('>Change</a>');
  });

  it('keeps the previous suggestion, prefilled values and city in the inputs state', () => {
    const body = render({
      kind: 'inputs',
      values: { city: 'Oakland', area: 'Rockridge', timeWindow: 'next weekend, morning' },
      previousSuggestionId: ID,
    });

    expect(hidden(body, 'previousSuggestionId')).toBe(ID);
    expect(body).toMatch(/<option[^>]*selected[^>]*>Oakland<\/option>/);
    expect(body).toMatch(/<input[^>]*name="area"[^>]*value="Rockridge"/);
    expect(body).toMatch(/<input[^>]*name="timeWindow"[^>]*value="next weekend, morning"/);
  });

  it('has no previousSuggestionId in the inputs state without one', () => {
    expect(render({ kind: 'inputs', values: {} })).not.toContain('previousSuggestionId');
  });

  it('escapes an area with markup in the inputs state', () => {
    const body = render({ kind: 'inputs', values: { area: '"><script>' }, previousSuggestionId: ID });

    expect(body).not.toContain('<script>');
    expect(body).toMatch(/<input[^>]*name="area"[^>]*value="&quot;&gt;&lt;script&gt;"/);
  });

  it('escapes an area with markup in the fallback Try suggesting again form', () => {
    const body = render({ ...fallback(), area: '"><script>', previousSuggestionId: ID });

    expect(body).not.toContain('<script>');
    expect(hidden(suggestAgainForm(body), 'area')).toBe('&quot;&gt;&lt;script&gt;');
    expect(body).toMatch(/<input type="hidden" name="area" value="&quot;&gt;&lt;script&gt;" \/>[\s\S]*Publish plan/);
  });

  it('escapes an area with markup in the Suggest another form and summary', () => {
    const body = render({ kind: 'card', suggestion: { ...okSuggestion, area: '"><script>' }, values: {} });

    expect(body).not.toContain('<script>');
    expect(hidden(suggestAgainForm(body), 'area')).toBe('&quot;&gt;&lt;script&gt;');
    expect(body).toMatch(/<input type="hidden" name="area" value="&quot;&gt;&lt;script&gt;" \/>[\s\S]*Publish plan/);
    expect(body).toContain('Oakland · &quot;&gt;&lt;script&gt; · next weekend, morning');
  });
});

function rowSummaries(body: string): Record<string, string | undefined> {
  const rows: Record<string, string | undefined> = {};
  for (const m of body.matchAll(/<div class="row-field" data-field="([a-z]+)"([^>]*)>/g)) {
    rows[m[1] ?? ''] = /data-summary="([^"]*)"/.exec(m[2] ?? '')?.[1];
  }
  return rows;
}

describe('createPage row summaries for create.js (UX §8.8)', () => {
  it('gives each card row its display text', () => {
    expect(rowSummaries(render(card()))).toEqual({
      where: 'Highwire Coffee Roasters',
      when: 'Sat 14 Nov · 10:00 AM',
      minimum: '3 people, you included',
      decide: 'Wed 11 Nov, 10:00 PM',
    });
  });

  it('builds the display text from the entered values on a re-render', () => {
    const body = render(
      card({ venue: 'Blue Bottle', date: '2026-11-21', time: '14:30', minimum: '5', deadlineDate: '2026-11-19', deadlineTime: '09:00' }),
    );

    expect(rowSummaries(body)).toEqual({
      where: 'Blue Bottle',
      when: 'Sat 21 Nov · 2:30 PM',
      minimum: '5 people, you included',
      decide: 'Thu 19 Nov, 9:00 AM',
    });
  });

  it('leaves out the display text for rows that are empty or not a valid value', () => {
    const body = render(fallback({ date: 'not-a-date', time: '10:00', minimum: 'x' }));

    expect(rowSummaries(body)).toEqual({ where: undefined, when: undefined, minimum: undefined, decide: undefined });
  });

  it('escapes the display text', () => {
    const body = render(card({ venue: '"><script>' }));

    expect(rowSummaries(body).where).toBe('&quot;&gt;&lt;script&gt;');
    expect(body).not.toContain('<script>');
  });
});

describe('createPage hooks for create.js', () => {
  it('gives the card rows, suggest forms and publish form the hooks create.js looks for', () => {
    const inputs = render({ kind: 'inputs', values: {} });
    const body = render(card());

    expect(inputs).toMatch(/<form method="post" action="\/suggest" data-suggest-form>/);
    expect([...body.matchAll(/<div class="row-field" data-field="([a-z]+)"/g)].map((m) => m[1])).toEqual([
      'where',
      'when',
      'minimum',
      'decide',
    ]);
    expect(body).toMatch(/<form method="post" action="\/plans" data-publish-form="card">/);
    expect(body).toMatch(/<form method="post" action="\/suggest" class="again" data-suggest-form>/);
    expect(render(fallback())).toMatch(/<form method="post" action="\/plans" data-publish-form="fallback">/);
  });
});

describe('createPage calvin-4 markup', () => {
  it('wraps the format, where, when, minimum and decide-by fields in one card', () => {
    const body = render(card());
    const cards = [...body.matchAll(/<div class="card">([\s\S]*?)<\/div>\s*<h2>/g)];

    expect(body.match(/class="card"/g)).toHaveLength(1);
    expect(cards).toHaveLength(1);
    for (const name of ['format', 'venue', 'date', 'time', 'minimum', 'deadlineDate', 'deadlineTime']) {
      expect(cards[0]?.[1]).toContain(`name="${name}"`);
    }
    expect(cards[0]?.[1]).not.toContain('name="email"');
  });

  it('gives the Change link class quiet and the context line class summary', () => {
    const body = render(card());

    expect(body).toContain('<p class="summary">');
    expect(body).toMatch(/<a href="\/\?suggestion=[^"]*" class="quiet">Change<\/a>/);
  });

  it('renders Suggest another and Try suggesting again as btn btn-secondary in a form with class again', () => {
    const another = suggestAgainForm(render(card()));
    const again = suggestAgainForm(render({ ...fallback({}, NOTICE), previousSuggestionId: ID }));

    for (const form of [another, again]) {
      expect(form).toContain('class="again"');
      expect(form).toMatch(/<button[^>]*class="btn btn-secondary"/);
    }
  });
});

const fromPlan: FromPlan = {
  id: '22222222-2222-4222-8222-222222222222',
  manageToken: 'M'.repeat(43),
  city: 'Oakland',
  area: 'Rockridge',
  timeWindow: 'next weekend, morning',
  format: 'Coffee',
  venue: 'Blue Bottle',
  minimum: 3,
  name: 'Ana Ruiz',
  email: 'ana@example.test',
};

const again = (values: Record<string, string> = {}): CreateState => ({ kind: 'again', from: fromPlan, values });

describe('createPage again state', () => {
  it('is headed "Same again, new date" and shows the card pre-filled (AC1)', () => {
    const body = render(again());

    expect(body).toContain('<h1>Same again, new date</h1>');
    expect(body).not.toContain('Suggest a plan</h1>');
    expect(body).toContain('value="Coffee"');
    expect(body).toContain('value="Blue Bottle"');
    expect(body).toMatch(/<input[^>]*name="minimum"[^>]*value="3"/);
    expect(body).toContain('value="Ana Ruiz"');
    expect(body).toContain('value="ana@example.test"');
    expect(body).toContain(`<input type="hidden" name="fromManageToken" value="${'M'.repeat(43)}" />`);
    expect(body).toContain('Oakland · Rockridge · next weekend, morning');
    for (const field of ['date', 'time', 'deadlineDate', 'deadlineTime']) {
      expect(body).toMatch(new RegExp(`<input[^>]*name="${field}"[^>]*value=""`));
    }
  });

  it('has no Suggest another, Change or suggestion link (AC1)', () => {
    const body = render(again());

    for (const absent of ['Suggest another', 'Change', 'change=1', 'data-suggest-form', 'name="suggestionId"', 'name="previousSuggestionId"']) {
      expect(body).not.toContain(absent);
    }
    expect(body).toContain('data-publish-form="again"');
  });

  it('keeps entered values and shows the error under the date (AC4 re-render)', () => {
    const body = render(again({ date: '', time: '10:00', name: 'Ana Ruiz' }), { date: 'Pick a date.' });

    expect(body).toContain('<p class="error" id="date-error">Pick a date.</p>');
    expect(body).toContain('aria-invalid="true"');
    expect(body).toMatch(/<input[^>]*name="time"[^>]*value="10:00"/);
  });

  it('escapes entered values on the again page', () => {
    const body = render(again({ name: '"><b>x' }));

    expect(body).not.toContain('<b>x');
  });
});
