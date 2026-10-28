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

describe('GET /healthz', () => {
  it('answers 200 ok as plain text', async () => {
    const app = createApp(buildDeps(), { baseUrl: 'https://calvin.test' });
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await res.text()).toBe('ok');
  });
});

const NOT_FOUND_COPY =
  "We can't find that plan. The link may be incomplete. Check it in your chat or email.";

function decodeEntities(html: string): string {
  return html
    .replaceAll('&#39;', "'")
    .replaceAll('&#x27;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

describe('not-found page', () => {
  it('answers GET /nope with a 404 HTML page that points back to the start', async () => {
    const app = createApp(buildDeps(), { baseUrl: 'https://calvin.test' });
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    const body = decodeEntities(await res.text());
    expect(body).toContain(NOT_FOUND_COPY);
    expect(body).toContain('<a href="/">Suggest a plan</a>');
  });
});

describe('routing edge cases', () => {
  it('answers any method on an unknown path with the same 404 page', async () => {
    const app = createApp(buildDeps(), { baseUrl: 'https://calvin.test' });
    const res = await app.request('/nope', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(decodeEntities(await res.text())).toContain(NOT_FOUND_COPY);
  });

  it('answers HEAD /healthz with 200', async () => {
    const app = createApp(buildDeps(), { baseUrl: 'https://calvin.test' });
    const res = await app.request('/healthz', { method: 'HEAD' });
    expect(res.status).toBe(200);
  });

  it('ignores the query string on /healthz', async () => {
    const app = createApp(buildDeps(), { baseUrl: 'https://calvin.test' });
    const res = await app.request('/healthz?x=1');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('answers a trailing-slash path and a malformed percent escape with 404, not 500', async () => {
    const app = createApp(buildDeps(), { baseUrl: 'https://calvin.test' });
    for (const path of ['/nope/', '/%E0%A4%A']) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
    }
  });
});
