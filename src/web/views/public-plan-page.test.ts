import { describe, expect, it } from 'vitest';
import type { DisplayState } from '../../domain/plan-rules.ts';
import type { PublicPlan } from '../../domain/plans.ts';
import { layout } from './layout.ts';
import { publicPlanOg, publicPlanPage } from './public-plan-page.ts';

function decodeEntities(html: string): string {
  return html.replaceAll('&#39;', "'").replaceAll('&#x27;', "'").replaceAll('&apos;', "'");
}

const plan = (overrides: Partial<PublicPlan> = {}): PublicPlan => ({
  state: 'open',
  format: 'coffee',
  venue: 'Blue Bottle',
  city: 'Oakland',
  gatheringAt: Temporal.Instant.from('2026-11-14T18:00:00Z'),
  commitDeadlineAt: Temporal.Instant.from('2026-11-12T06:00:00Z'),
  minimum: 3,
  names: ['Ana Ruiz'],
  ...overrides,
});

type PageOptions = Omit<Parameters<typeof publicPlanPage>[0], 'plan' | 'state'>;

const render = (
  p: PublicPlan,
  state: DisplayState = 'needs_more',
  options: Partial<PageOptions> = {},
) => String(publicPlanPage({ plan: p, state, publicToken: 'tok123', ...options }));

describe('publicPlanPage', () => {
  it('renders the open plan with pill, venue, time, seats and deadline line', () => {
    const body = render(plan());

    expect(body).toContain('Needs 2 more');
    expect(body).toContain('Coffee');
    expect(body).toContain('<h1 class="venue">Blue Bottle</h1>');
    expect(body).toContain('<p class="when">Sat 14 Nov · 10:00 AM</p>');
    expect(body).toContain('<p class="where">Oakland</p>');
    expect(body).toContain('Ana');
    expect(body).not.toContain('Ruiz');
    expect(body.match(/you\?/g)).toHaveLength(1);
    expect(body.match(/<li/g)).toHaveLength(3);
    expect(body).toContain('aria-label="1 of 3 people in"');
    expect(body).toContain('Goes ahead with a minimum of 3. Decide by Wed 11 Nov, 10:00 PM.');
    expect(body.match(/<h1/g)).toHaveLength(1);
  });

  it('escapes a committer name and shows only the first name', () => {
    const body = render(plan({ names: ['<b>Bartholomew-Alexander</b> Smith'] }));

    expect(body).toContain('&lt;b&gt;Bartholomew-A');
    expect(body).not.toContain('<b>');
  });

  it('caps a first name at 16 code points without splitting emoji', () => {
    const body = render(plan({ names: ['😀'.repeat(20)] }));

    expect(body).toContain('😀'.repeat(16));
    expect(body).not.toContain('😀'.repeat(17));
  });

  it('shows the first word of a name with extra whitespace', () => {
    const body = render(plan({ names: ['  Mia   Chen'] }));

    expect(body).toContain('Mia');
    expect(body).not.toContain('Chen');
  });

  it('escapes venue and format', () => {
    const body = render(plan({ venue: '<script>x</script> & Co', format: 'a&b' }));

    expect(body).not.toContain('<script>');
    expect(body).toContain('&lt;script&gt;x&lt;/script&gt; &amp; Co');
    expect(body).toContain('A&amp;b');
  });

  it('shows no empty seat, no "you?" and no negative count when over the minimum', () => {
    const body = render(plan({ names: ['A', 'B', 'C', 'D'] }));

    expect(body).not.toContain('you?');
    expect(body.match(/<li/g)).toHaveLength(4);
    expect(body).toContain('Needs 0 more');
    expect(body).not.toContain('-1');
  });

  it("the on state shows the It's on pill, filled seats, no empty seat and the welcome line", () => {
    const body = render(plan({ state: 'confirmed', names: ['Ana Ruiz', 'Raj Rao', 'Mia Chen'] }), 'on');

    expect(body).toMatch(/It(&#39;|')s on/);
    expect(body).toContain('More people are welcome until it starts.');
    expect(body).not.toContain('you?');
    expect(body).not.toContain('seat-empty');
    expect(body).not.toContain('Goes ahead with a minimum');
    expect(body).toContain('name="email"');
  });

  it('a confirmed plan with four committers and minimum 3 renders four filled seats and no "Needs"', () => {
    const body = render(plan({ state: 'confirmed', names: ['A', 'B', 'C', 'D'] }), 'on');

    expect(body.match(/<li class="seat"/g)).toHaveLength(4);
    expect(body.match(/class="token"/g)).toHaveLength(4);
    expect(body).not.toContain('Needs');
    expect(body).not.toContain('you?');
    expect(body).not.toContain('-1');
  });

  it('happening_now shows the pill, the seats and no form', () => {
    const body = render(plan({ state: 'confirmed', names: ['Ana Ruiz', 'Raj Rao', 'Mia Chen'] }), 'happening_now');

    expect(body).toContain('Happening now');
    expect(body.match(/<li class="seat"/g)).toHaveLength(3);
    expect(body).not.toContain('More people are welcome');
    expect(body).not.toContain('name="email"');
  });

  it('was_on shows "This was on Sat 14 Nov" and no form', () => {
    const body = render(plan({ state: 'confirmed', names: ['Ana Ruiz', 'Raj Rao', 'Mia Chen'] }), 'was_on');

    expect(body).toContain('This was on Sat 14 Nov');
    expect(body.match(/<li class="seat"/g)).toHaveLength(3);
    expect(body).not.toContain('More people are welcome');
    expect(body).not.toContain('name="email"');
  });

  it('the on notice replaces the form and escapes n', () => {
    const confirmed = plan({ state: 'confirmed', names: ['Ana Ruiz', 'Raj Rao', 'Mia Chen'] });
    const body = render(confirmed, 'on', { notice: { code: 'on', n: '<b>Mia</b>' } });

    expect(body).toMatch(
      /<p class="notice notice-on" role="status">\s*You(&#39;|')re in, &lt;b&gt;Mia&lt;\/b&gt;\. It(&#39;|')s on! We(&#39;|')ve emailed you the details and we(&#39;|')ll remind you the day before\.\s*<\/p>/,
    );
    expect(body).not.toContain('<b>Mia');
    expect(body).not.toContain('name="email"');

    const long = render(confirmed, 'on', { notice: { code: 'on', n: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' } });
    expect(long).toContain('ABCDEFGHIJKLMNOP.');
    expect(long).not.toContain('ABCDEFGHIJKLMNOPQ');
  });

  it('the on notice without n', () => {
    const body = render(plan({ state: 'confirmed', names: ['A', 'B', 'C'] }), 'on', { notice: { code: 'on' } });

    expect(body).toMatch(
      /role="status">\s*You(&#39;|')re in\. It(&#39;|')s on! We(&#39;|')ve emailed you the details and we(&#39;|')ll remind you the day before\.\s*<\/p>/,
    );
  });

  it('renders not-this-time without a list, a count or committer names', () => {
    const body = render(plan({ state: 'called_off' }), 'not_this_time');

    expect(body).toContain('Not this time');
    expect(body).toContain("This one isn't going ahead. No harm done. Maybe next time.");
    expect(body).toContain('<a class="quiet" href="/">Suggest a plan</a>');
    expect(body).not.toContain('<ul');
    expect(body).not.toContain('Ana');
    expect(body).not.toMatch(/\d of \d/);
  });

  it('a not_this_time page has a pill with class state-off, no form', () => {
    const body = render(plan({ state: 'called_off' }), 'not_this_time');

    expect(body).toContain('<p class="pill state-off">Not this time</p>');
    expect(body).not.toContain('<form');
  });

  it('closed notice comes before the pill', () => {
    const body = decodeEntities(render(plan({ state: 'called_off' }), 'not_this_time', { notice: { code: 'closed' } }));

    expect(body).toContain("This one isn't taking commits any more.");
    expect(body.indexOf("This one isn't taking commits any more.")).toBeLessThan(body.indexOf('class="pill state-off"'));
  });
});

describe('publicPlanPage commit form', () => {
  it('shows the commit form with its attributes and help on an open plan', () => {
    const body = render(plan());

    expect(body).toContain('<form method="post" action="/p/tok123/commit"');
    const nameInput = body.match(/<input[^>]*name="name"[^>]*>/s)?.[0] ?? '';
    const emailInput = body.match(/<input[^>]*name="email"[^>]*>/s)?.[0] ?? '';
    expect(nameInput).toContain('autocomplete="name"');
    expect(nameInput).toContain('autocapitalize="words"');
    expect(emailInput).toContain('type="email"');
    expect(emailInput).toContain('inputmode="email"');
    expect(body).toContain("Only used to tell you if it's on. Never shown to anyone.");
    expect(body).toMatch(/<button[^>]*>\s*I(&#39;|')m in\s*<\/button>/);
    expect(body).not.toContain('<script');
    const wrapped = String(layout('Plan', publicPlanPage({ plan: plan(), state: 'needs_more', publicToken: 'tok123' })));
    expect(wrapped.match(/<link rel="stylesheet"/g)).toHaveLength(1);
  });

  it('updated notice replaces the form', () => {
    const body = render(plan(), 'needs_more', { notice: { code: 'updated', n: 'Mia' } });

    expect(body).toMatch(/<p[^>]*role="status"[^>]*>\s*Updated: you(&#39;|')re in as Mia\.\s*<\/p>/);
    expect(body).not.toContain('<form');
  });

  it('closed notice shows with no form on a not_this_time plan', () => {
    const body = render(plan({ state: 'called_off' }), 'not_this_time', { notice: { code: 'closed' } });

    expect(body).toMatch(/<p[^>]*role="status"[^>]*>\s*This one isn(&#39;|')t taking commits any more\.\s*<\/p>/);
    expect(body).not.toContain('<form');
  });

  it('unknown notice code renders no notice and keeps the form', () => {
    const body = render(plan(), 'needs_more', { notice: { code: 'bogus', n: 'Mia' } });

    expect(body).not.toContain('role="status"');
    expect(body).not.toContain('class="notice"');
    expect(body).not.toContain('undefined');
    expect(body).toContain('<form');
  });

  it('reads sanely with no n and caps n at 16 characters', () => {
    const noName = (code: string) => render(plan(), 'needs_more', { notice: { code } });

    expect(noName('in')).toMatch(/You(&#39;|')re in\. We(&#39;|')ll email you if it(&#39;|')s on\./);
    expect(noName('updated')).toMatch(/Updated: you(&#39;|')re in\./);
    expect(noName('in')).not.toContain('undefined');
    expect(noName('updated')).not.toContain('undefined');

    const long = render(plan(), 'needs_more', { notice: { code: 'in', n: 'Ab Cdefghijklmnopqrstu' } });
    expect(long).toContain('You&#39;re in, Ab Cdefghijklmno. ');
    expect(long).not.toContain('Ab Cdefghijklmnop');
  });

  it('escapes markup in n and in the kept name value', () => {
    const inNotice = render(plan(), 'needs_more', { notice: { code: 'in', n: '<b>Mia</b>' } });
    expect(inNotice).toContain('&lt;b&gt;Mia&lt;/b&gt;');
    expect(inNotice).not.toContain('<b>');

    const kept = render(plan(), 'needs_more', {
      form: { values: { name: '<b>Mia</b>', email: '"><i>x' }, errors: {} },
    });
    expect(kept).toContain('value="&lt;b&gt;Mia&lt;/b&gt;"');
    expect(kept).not.toContain('<b>');
    expect(kept).not.toContain('<i>');
  });

  it('renders field errors under the fields and keeps the entered values', () => {
    const body = render(plan(), 'needs_more', {
      form: {
        values: { name: 'Mia', email: 'nope' },
        errors: { name: 'Add your name.', email: 'That email looks incomplete.' },
      },
    });

    expect(body).toContain('<p class="error" id="name-error">Add your name.</p>');
    expect(body).toContain('<p class="error" id="email-error">That email looks incomplete.</p>');
    const nameInput = body.match(/<input[^>]*name="name"[^>]*>/s)?.[0] ?? '';
    const emailInput = body.match(/<input[^>]*name="email"[^>]*>/s)?.[0] ?? '';
    expect(nameInput).toContain('aria-describedby="name-error"');
    expect(nameInput).toContain('aria-invalid="true"');
    expect(nameInput).toContain('value="Mia"');
    expect(emailInput).toContain('aria-describedby="email-error"');
    expect(emailInput).toContain('aria-invalid="true"');
    expect(emailInput).toContain('value="nope"');
    expect(body.indexOf('id="name-error"')).toBeGreaterThan(body.indexOf('name="name"'));
    expect(body.indexOf('id="email-error"')).toBeGreaterThan(body.indexOf('name="email"'));
  });

  it('the seat row after Ana and Mia shows Ana, Mia and one you?', () => {
    const body = render(plan({ names: ['Ana Ruiz', 'Mia Chen'], minimum: 3 }));

    expect(body).toContain('Needs 1 more');
    const seatList = body.match(/<ul class="seats"[\s\S]*?<\/ul>/)?.[0] ?? '';
    expect(seatList.match(/<li/g)).toHaveLength(3);
    expect(seatList).toContain('Ana');
    expect(seatList).toContain('Mia');
    expect(seatList.match(/you\?/g)).toHaveLength(1);
    expect(seatList).not.toContain('Ruiz');
    expect(seatList).not.toContain('Chen');
  });

  it('closed notice keeps the form on a plan that still takes commits', () => {
    const body = render(plan(), 'needs_more', { notice: { code: 'closed' } });

    expect(body).toMatch(/This one isn(&#39;|')t taking commits any more\./);
    expect(body).toContain('<form');
  });

  it('in notice replaces the form', () => {
    const body = render(plan(), 'needs_more', { notice: { code: 'in', n: 'Mia' } });

    expect(body).toMatch(/<p[^>]*role="status"[^>]*>\s*You(&#39;|')re in, Mia\. We(&#39;|')ll email you if it(&#39;|')s on\.\s*<\/p>/);
    expect(body).not.toContain('<form');
    expect(body).not.toContain('name="email"');
  });
});

describe('publicPlanPage frame markup', () => {
  it('AC4: the open plan uses the state, venue, when, where and seat-row markup', () => {
    const body = render(plan({ names: ['Ana Ruiz', 'Mia Chen'], minimum: 3 }));

    expect(body).toContain('<p class="pill state-open">Needs 1 more</p>');
    expect(body).toContain('<h1 class="venue">Blue Bottle</h1>');
    expect(body).toContain('<p class="when">Sat 14 Nov · 10:00 AM</p>');
    expect(body).toContain('<p class="where">Oakland</p>');
    expect(body).toContain('<ul class="seats" aria-label="2 of 3 people in">');
    expect(body).toContain('<span class="token" aria-hidden="true">A</span>');
    expect(body).toContain('<span class="token" aria-hidden="true">M</span>');
    expect(body.match(/seat seat-you/g)).toHaveLength(1);
    expect(body.match(/<li class="seat seat-you">[\s\S]*?<\/li>/)?.[0]).toContain('you?');
  });

  it('AC5: on and happening_now take the on and now state classes and the seats-on row', () => {
    const on = render(plan({ names: ['Ana', 'Mia', 'Raj'] }), 'on');
    expect(on).toContain('pill state-on');
    expect(on).toMatch(/It(&#39;|')s on/);
    expect(on).toContain('class="seats seats-on"');
    expect(on).not.toContain('just-on');

    const fresh = render(plan({ names: ['Ana', 'Mia', 'Raj'] }), 'on', { notice: { code: 'on', n: 'Raj' } });
    expect(fresh).toContain('seats seats-on just-on');

    const now = render(plan({ names: ['Ana', 'Mia', 'Raj'] }), 'happening_now');
    expect(now).toContain('pill state-now');
    expect(now).toContain('Happening now');
    expect(now).toContain('class="seats seats-on"');
  });

  it('was_on uses state-off and no seats-on, nor does needs_more', () => {
    const was = render(plan({ names: ['Ana', 'Mia', 'Raj'] }), 'was_on');
    expect(was).toContain('pill state-off');
    expect(was).toContain('This was on Sat 14 Nov');
    expect(was).not.toContain('seats-on');
    expect(render(plan(), 'not_this_time')).toContain('pill state-off');
    expect(render(plan())).not.toContain('seats-on');
  });

  it('AC6: the notice sits after the brand and before the state and heading', () => {
    const on = render(plan({ names: ['Ana', 'Mia', 'Raj'] }), 'on', { notice: { code: 'on', n: 'Raj' } });
    const closed = render(plan(), 'not_this_time', { notice: { code: 'closed' } });
    for (const body of [on, closed]) {
      const at = body.indexOf('role="status"');
      expect(at).toBeGreaterThan(body.indexOf('class="brand"'));
      expect(at).toBeLessThan(body.indexOf('class="pill'));
      expect(at).toBeLessThan(body.indexOf('<h1'));
    }
    expect(on).toContain('notice notice-on');
  });

  it('builds tokens from the first code point and trims leading space', () => {
    expect(render(plan({ names: ['\u{1F600}'.repeat(20)] }))).toContain('<span class="token" aria-hidden="true">\u{1F600}</span>');
    expect(render(plan({ names: ['  mia chen'] }))).toContain('aria-hidden="true">M</span>');
    const full = render(plan({ names: ['A', 'B', 'C', 'D'], minimum: 3 }));
    expect(full).not.toContain('seat-you');
    expect(full).not.toContain('seat-empty');
  });
});

describe('publicPlanOg', () => {
  it('builds the title, description, image and site name', () => {
    expect(publicPlanOg(plan(), 'needs_more', 'https://calvin.test')).toEqual({
      title: 'Coffee at Blue Bottle',
      description: 'Sat 14 Nov · 10:00 AM · Oakland. Goes ahead if 3 are in.',
      image: 'https://calvin.test/static/og.png',
      siteName: 'calvin',
    });
  });

  it("appends \" It's on.\" only for on and nothing for the other states", () => {
    const base = 'Sat 14 Nov · 10:00 AM · Oakland. Goes ahead if 3 are in.';
    expect(publicPlanOg(plan(), 'on', 'https://calvin.test')?.description).toBe(`${base} It's on.`);
    for (const state of ['needs_more', 'happening_now', 'was_on'] as const) {
      expect(publicPlanOg(plan(), state, 'https://calvin.test')?.description).toBe(base);
    }
  });

  it('og description for not_this_time is "Not this time"', () => {
    expect(publicPlanOg(plan(), 'not_this_time', 'https://calvin.test')?.description).toBe('Not this time');
  });
});
