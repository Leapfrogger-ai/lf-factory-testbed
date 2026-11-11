import { describe, expect, it } from 'vitest';
import type { WithdrawTarget } from '../../domain/plans.ts';
import { withdrawPage } from './withdraw-page.ts';

const target = (overrides: Partial<WithdrawTarget> = {}): WithdrawTarget => ({
  state: 'confirmed',
  format: 'coffee',
  venue: 'Blue Bottle',
  gatheringAt: Temporal.Instant.from('2026-11-14T18:00:00Z'),
  withdrawn: false,
  publicToken: 'ptok123',
  ...overrides,
});

const before = Temporal.Instant.from('2026-11-10T00:00:00Z');
const atStart = Temporal.Instant.from('2026-11-14T18:00:00Z');

const render = (t: WithdrawTarget, now: Temporal.Instant = before) =>
  String(withdrawPage({ target: t, token: 'wtok123', now })).replaceAll('&#39;', "'");

describe('withdrawPage markup', () => {
  it('keeps the Withdraw button btn btn-primary and the question is the only h1', () => {
    const body = render(target());

    expect(body).toMatch(/<button[^>]*class="btn btn-primary"[^>]*>Withdraw<\/button>/);
    expect(body.match(/<h1[ >]/g)).toHaveLength(1);
  });
});

describe('withdrawPage', () => {
  it('the confirm view asks "Withdraw from Coffee at Blue Bottle on Sat 14 Nov?" with a Withdraw button', () => {
    const body = render(target());

    expect(body).toContain('Withdraw from Coffee at Blue Bottle on Sat 14 Nov?');
    expect(body).toContain('method="post"');
    expect(body).toContain('action="/w/wtok123"');
    expect(body).toContain('Withdraw</button>');
    expect(body).not.toContain('<input');
  });

  it('the done view has an h1 "You\'re out", a copy paragraph, the Suggest a plan link and no button', () => {
    const body = render(target({ withdrawn: true }));

    expect(body).toMatch(
      /<h1>You're out<\/h1>\s*<p[^>]*>You've withdrawn from Coffee on Sat 14 Nov\. No more emails about it\.<\/p>/,
    );
    expect(body).toContain('<a class="quiet" href="/">Suggest a plan</a>');
    expect(body).not.toContain('<button');
    expect(body).not.toContain('<form');
  });

  it('the confirm view does not offer Suggest a plan', () => {
    expect(render(target())).not.toContain('Suggest a plan');
  });

  it('a started plan reads "This one has already started." with the link and no button', () => {
    const body = render(target(), atStart);

    expect(body).toContain('This one has already started.');
    expect(body).toContain('<a class="quiet" href="/">Suggest a plan</a>');
    expect(body).not.toContain('<form');
    expect(body).not.toContain('<button');
  });

  it('a called-off plan reads "This one isn\'t going ahead, so there\'s nothing to withdraw from." with no button', () => {
    const body = render(target({ state: 'called_off' }));

    expect(body).toContain("This one isn't going ahead, so there's nothing to withdraw from.");
    expect(body).toContain('<a class="quiet" href="/">Suggest a plan</a>');
    expect(body).not.toContain('<form');
    expect(body).not.toContain('<button');
  });

  it('venue and format are escaped', () => {
    const body = render(target({ venue: '<b>Blue</b>', format: '<i>x</i>' }));

    expect(body).toContain('&lt;b&gt;Blue&lt;/b&gt;');
    expect(body).toContain('&lt;i&gt;x&lt;/i&gt;');
    expect(body).not.toContain('<b>');
    expect(body).not.toContain('<i>');
  });

  it('the format is escaped on the done view too', () => {
    const body = render(target({ format: '<i>x</i>', withdrawn: true }));

    expect(body).toContain('&lt;i&gt;x&lt;/i&gt;');
    expect(body).not.toContain('<i>');
  });

  it('the started view wins over withdrawn', () => {
    const body = render(target({ withdrawn: true }), atStart);

    expect(body).toContain('This one has already started.');
    expect(body).not.toContain("You're out");
  });
});
