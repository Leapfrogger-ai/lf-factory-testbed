import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import type { AppDeps } from './app.ts';

function buildDeps(): AppDeps {
  const fail = (name: string) => () => {
    throw new Error(name + ' must not be called');
  };
  return {
    db: new Proxy(
      {},
      {
        get(_target, prop) {
          throw new Error('db accessed: ' + String(prop));
        },
      },
    ) as AppDeps['db'],
    now: () => ({ epochMilliseconds: 0 }) as unknown as Temporal.Instant,
    suggestPlanCall: fail('suggestPlanCall'),
    sendEmail: fail('sendEmail'),
    planWorkflows: { start: fail('start'), signal: fail('signal') },
  } as AppDeps;
}

const appUnderTest = () => createApp(buildDeps(), { baseUrl: 'https://calvin.test' });

describe('response headers', () => {
  it('sets the spec section 2 headers and noindex on a 404', async () => {
    const res = await appUnderTest().request('/nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    const csp = res.headers.get('content-security-policy') ?? '';
    const directives = new Set(csp.split('; ').map((d) => d.replace(/'nonce-[^']+'/, "'nonce-<n>'")));
    expect(directives).toEqual(
      new Set([
        "default-src 'self'",
        "script-src 'self' 'nonce-<n>'",
        "style-src 'self'",
        "img-src 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
      ]),
    );
    expect(await res.text()).toContain('<meta name="robots" content="noindex"');
  });

  it('omits x-robots-tag on GET / but keeps no-store', async () => {
    const res = await appUnderTest().request('/');
    expect(res.headers.get('x-robots-tag')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('marks /healthz noindex', async () => {
    const res = await appUnderTest().request('/healthz');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('does not put no-store on static files', async () => {
    const res = await appUnderTest().request('/static/app.css');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).not.toBe('no-store');
  });
});
