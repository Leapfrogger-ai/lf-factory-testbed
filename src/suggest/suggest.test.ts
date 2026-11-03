import { describe, expect, it } from 'vitest';
import { fakeSuggest, fixedClock } from '../../tests/support/fakes.ts';
import { loadFixture } from '../../tests/support/fixtures.ts';
import { suggest } from './suggest.ts';

const input = { city: 'Oakland', area: 'Rockridge', timeWindow: 'next weekend, morning' };
const now = fixedClock('2026-11-09T18:00:00Z');

describe('suggest', () => {
  it('request names the model, both tools and sets no forbidden parameter (AC2)', async () => {
    const fake = fakeSuggest(loadFixture('good'));
    await suggest(input, { suggestPlanCall: fake.call, now });

    const { request, options } = fake.calls[0]!;
    expect(request.model).toBe('claude-sonnet-5-5');
    const tools = request.tools as { type?: string; name: string; strict?: boolean }[];
    expect(tools.find((tool) => tool.type === 'web_search_20260318')).toEqual({
      type: 'web_search_20260318',
      name: 'web_search',
      max_uses: 2,
      user_location: {
        type: 'approximate',
        city: 'Oakland',
        region: 'California',
        country: 'US',
        timezone: 'America/Los_Angeles',
      },
    });
    expect(tools.find((tool) => tool.name === 'propose_plan')?.strict).toBe(true);
    expect(request).not.toHaveProperty('temperature');
    expect(request).not.toHaveProperty('thinking');
    expect(request).not.toHaveProperty('tool_choice');
    expect(request.output_config.effort).toBe('low');
    expect(request.system).toContain('coffee, drinks or a walk');
    expect(request.system).toContain("Never propose hosting at someone's home");
    const user = JSON.stringify(request.messages);
    expect(user).toContain('Oakland');
    expect(user).toContain('Rockridge');
    expect(user).toContain('next weekend, morning');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns the proposal from the good response', async () => {
    const fake = fakeSuggest(loadFixture('good'));
    const result = await suggest(input, { suggestPlanCall: fake.call, now });

    expect(result).toMatchObject({ outcome: 'ok' });
    if (result.outcome !== 'ok') throw new Error('expected ok');
    expect(result.proposal.format).toBe('coffee');
    expect(result.proposal.venue).toBe('Highwire Coffee Roasters');
    expect(result.proposal.venueAddress).toBe('5700 College Ave, Oakland, CA');
    expect(result.proposal.venueUrl).toBe('https://example.test/highwire');
    expect(result.proposal.gatheringAt.toString()).toBe('2026-11-14T18:00:00Z');
    expect(result.proposal.minimum).toBe(3);
  });

  it.each([
    ['no-tool-call', 'no_proposal'],
    ['pause-turn', 'pause_turn'],
    ['refusal', 'refusal'],
    ['max-tokens', 'max_tokens'],
  ] as const)('fails with the matching reason for the %s response (AC3)', async (name, failureReason) => {
    const fake = fakeSuggest(loadFixture(name));
    const result = await suggest(input, { suggestPlanCall: fake.call, now });
    expect(result).toMatchObject({ outcome: 'failed', failureReason });
  });

  it.each([
    ['boom', 'api_error'],
    ['APIConnectionTimeoutError', 'timeout'],
    ['APIUserAbortError', 'timeout'],
  ] as const)('fails when the call rejects with %s (AC3)', async (name, failureReason) => {
    const fake = fakeSuggest(loadFixture('good'));
    fake.failWith(Object.assign(new Error('boom'), { name }));
    const result = await suggest(input, { suggestPlanCall: fake.call, now });
    expect(result).toMatchObject({ outcome: 'failed', failureReason });
  });

  const withInput = (edit: (proposal: Record<string, unknown>) => void) => {
    const response = loadFixture('good');
    const call = response.content.find((block) => block.name === 'propose_plan')!;
    edit(call.input as Record<string, unknown>);
    return response;
  };

  it.each([
    ['minimum 1', (p: Record<string, unknown>) => (p.minimum = 1)],
    ['an empty venue', (p: Record<string, unknown>) => (p.venue = '')],
    ['a whitespace venue', (p: Record<string, unknown>) => (p.venue = '   ')],
    ['a 121-character venue', (p: Record<string, unknown>) => (p.venue = 'v'.repeat(121))],
    ['a 41-character format', (p: Record<string, unknown>) => (p.format = 'f'.repeat(41))],
    [
      'a gathering already past',
      (p: Record<string, unknown>) => {
        p.date = '2026-11-09';
        p.time = '10:00';
      },
    ],
    ['an impossible date', (p: Record<string, unknown>) => (p.date = '2026-02-30')],
    ['a missing venue', (p: Record<string, unknown>) => delete p.venue],
  ])('fails with invalid_proposal for %s (AC4)', async (_label, edit) => {
    const fake = fakeSuggest(withInput(edit));
    const result = await suggest(input, { suggestPlanCall: fake.call, now });
    expect(result).toMatchObject({ outcome: 'failed', failureReason: 'invalid_proposal' });
  });

  it('turns an empty venue_address or venue_url into null', async () => {
    const fake = fakeSuggest(
      withInput((p) => {
        p.venue_address = '';
        p.venue_url = '';
      }),
    );
    const result = await suggest(input, { suggestPlanCall: fake.call, now });
    if (result.outcome !== 'ok') throw new Error('expected ok');
    expect(result.proposal.venueAddress).toBeNull();
    expect(result.proposal.venueUrl).toBeNull();
  });

  it('reports a latency of 0 under the fixed clock', async () => {
    const fake = fakeSuggest(loadFixture('good'));
    const result = await suggest(input, { suggestPlanCall: fake.call, now });
    expect(result.latencyMs).toBe(0);
  });
});
