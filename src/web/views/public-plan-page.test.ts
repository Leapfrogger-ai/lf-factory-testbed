import { describe, expect, it } from 'vitest';
import type { PublicPlan } from '../../domain/plans.ts';
import { publicPlanOg, publicPlanPage } from './public-plan-page.ts';

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

const render = (p: PublicPlan, state: 'needs_more' | 'not_this_time' | 'on' = 'needs_more') =>
  String(publicPlanPage({ plan: p, state }));

describe('publicPlanPage', () => {
  it('renders the open plan with pill, venue, time, seats and deadline line', () => {
    const body = render(plan());

    expect(body).toContain('Needs 2 more');
    expect(body).toContain('Coffee');
    expect(body).toContain('<h1>Blue Bottle</h1>');
    expect(body).toContain('Oakland · Sat 14 Nov · 10:00 AM');
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

  it("renders It's on with the seats for an on plan", () => {
    const body = render(plan({ state: 'confirmed', names: ['A', 'B', 'C'] }), 'on');

    expect(body).toContain('It&#39;s on');
    expect(body).not.toContain('you?');
  });

  it('renders not-this-time without a list, a count or committer names', () => {
    const body = render(plan({ state: 'called_off' }), 'not_this_time');

    expect(body).toContain('Not this time');
    expect(body).toContain("This one isn't going ahead. No harm done. Maybe next time.");
    expect(body).toContain('<a href="/">Suggest a plan</a>');
    expect(body).not.toContain('<ul');
    expect(body).not.toContain('Ana');
    expect(body).not.toMatch(/\d of \d/);
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

  it('appends It\'s on for an on plan and shows Not this time alone for a called-off one', () => {
    expect(publicPlanOg(plan(), 'on', 'https://calvin.test')?.description).toBe(
      "Sat 14 Nov · 10:00 AM · Oakland. Goes ahead if 3 are in. It's on.",
    );
    expect(publicPlanOg(plan(), 'not_this_time', 'https://calvin.test')?.description).toBe('Not this time');
  });
});
