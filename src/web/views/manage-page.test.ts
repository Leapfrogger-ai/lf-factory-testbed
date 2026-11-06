import { describe, expect, it } from 'vitest';
import type { DisplayState } from '../../domain/plan-rules.ts';
import type { ManagePlan } from '../../domain/plans.ts';
import { managePage } from './manage-page.ts';

const plan = (overrides: Partial<ManagePlan> = {}): ManagePlan => ({
  state: 'open',
  format: 'coffee',
  venue: 'Blue Bottle',
  city: 'Oakland',
  gatheringAt: Temporal.Instant.from('2026-11-14T18:00:00Z'),
  commitDeadlineAt: Temporal.Instant.from('2026-11-12T06:00:00Z'),
  minimum: 3,
  names: ['Ana Ruiz', 'Mia Chen'],
  publicToken: 'PUB',
  manageToken: 'MAN',
  ...overrides,
});

const NOW = Temporal.Instant.from('2026-11-10T12:00:00Z');

const render = (
  p: ManagePlan = plan(),
  state: DisplayState = 'needs_more',
  options: Partial<Parameters<typeof managePage>[0]> = {},
) =>
  String(
    managePage({ plan: p, state, publicLink: 'https://calvin.test/p/PUB', now: NOW, ...options }),
  )
    .replaceAll('&#39;', "'")
    .replaceAll('&#x27;', "'");

describe('managePage', () => {
  it('shows M1 in order', () => {
    const body = render();
    const parts = [
      '<p class="private">Your plan. Only you can see this page.</p>',
      '<p class="brand">calvin</p>',
      '<p class="pill state-open">Needs 1 more · decide by Wed 11 Nov, 10:00 PM</p>',
      '<h1 class="venue">Blue Bottle</h1>',
      '2 of 3',
      `<ul class="names" aria-label="Who's in">`,
      '<span class="token" aria-hidden="true">A</span>',
      'Ana Ruiz',
      '<span class="token" aria-hidden="true">M</span>',
      'Mia Chen',
      'class="linkbox"',
      'value="https://calvin.test/p/PUB"',
      '>Copy</button>',
      'href="/m/MAN/new"',
      'Start a new plan from this',
      '<summary class="quiet">Call it off</summary>',
    ];
    const indexes = parts.map((part) => body.indexOf(part));
    expect(parts.filter((_, i) => indexes[i] === -1)).toEqual([]);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    expect(new Set(indexes).size).toBe(indexes.length);
    expect(body).toContain('class="btn btn-secondary" href="/m/MAN/new"');
  });

  it('confirmed is M3', () => {
    const body = render(plan({ names: ['Ana Ruiz', 'Mia Chen', 'Raj Rao'] }), 'on');

    expect(body).toContain(`<p class="pill state-on">It's on</p>`);
    expect(body).toContain('class="names names-on"');
    expect(body).toContain('<summary class="quiet">Call it off</summary>');
    expect(body).toContain('class="btn btn-secondary" href="/m/MAN/new"');
  });

  it('called off is M5', () => {
    const body = render(plan(), 'not_this_time');

    expect(body).toContain('<p class="pill state-off">Not this time</p>');
    expect(body).toContain(`class="names names-off" aria-label="Who was in"`);
    expect(body).toContain('venue venue-off');
    expect(body).not.toContain('class="count"');
    expect(body).not.toContain('seat-empty');
    expect(body).not.toContain('linkbox');
    expect(body).not.toContain('Call it off');
    expect(body).toContain('<a class="btn btn-primary" href="/m/MAN/new">Start a new plan from this</a>');
  });

  it('started has no call-off', () => {
    const started = Temporal.Instant.from('2026-11-14T18:00:00Z');
    const bodies = [
      render(plan(), 'happening_now'),
      render(plan(), 'was_on'),
      render(plan(), 'on', { now: started }),
      render(plan(), 'on', { now: Temporal.Instant.from('2026-11-14T18:00:01Z') }),
    ];

    for (const body of bodies) {
      expect(body).not.toContain('Call it off');
      expect(body).not.toContain('<details');
    }
  });

  it('shows no email, and escapes names', () => {
    const body = render(plan({ names: ['<b>x</b>'] }));

    expect(body).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(body).not.toContain('<b>x</b>');
    expect(body).not.toContain('@');
  });

  it('shows a long emoji name in full with one whole-emoji token', () => {
    const name = '😀'.repeat(20);
    const body = render(plan({ names: [name] }));

    expect(body).toContain(`<span class="token" aria-hidden="true">😀</span>${name}`);
  });

  it('shows 4 of 3 and no empty seat once confirmed over the minimum', () => {
    const body = render(plan({ names: ['A A', 'B B', 'C C', 'D D'] }), 'on');

    expect(body).toContain('4 of 3');
    expect(body).not.toContain('seat-empty');
  });

  it('opens to the confirm', () => {
    const body = render();
    const confirm = `Call it off? Everyone who's in gets a short "not this time" email.`;
    const escaped = confirm.replaceAll('"', '&quot;');

    expect(body.includes(confirm) || body.includes(escaped)).toBe(true);
    expect(body).toContain('<a class="quiet" href="/m/MAN">Keep it</a>');
    const form = /<form method="post" action="\/m\/MAN\/call-off">([\s\S]*?)<\/form>/.exec(body);
    expect(form).not.toBeNull();
    expect(form?.[1]).toMatch(/<button[^>]*btn btn-dim[^>]*>Call it off<\/button>/);
    expect(form?.[1]).not.toContain('<input');
  });

  it('shows the too-late notice above the pill (AC4)', () => {
    const body = render(plan(), 'happening_now', { notice: 'too-late' });
    const notice = `<p class="notice" role="status">It's already started, so it can't be called off.</p>`;
    expect(body).toContain(notice);
    expect(body.indexOf(notice)).toBeLessThan(body.indexOf('class="pill'));
  });

  it('shows no notice without the option', () => {
    expect(render(plan(), 'happening_now')).not.toContain('class="notice"');
  });
});
