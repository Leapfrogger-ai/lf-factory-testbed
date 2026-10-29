import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newToken } from '../domain/tokens.ts';
import { testDeps } from '../../tests/support/builders.ts';
import { createApp } from './app.ts';
import { redactPath } from './request-logger.ts';

const TOKEN = 'A'.repeat(43);

describe('redactPath', () => {
  it.each([
    [`/p/${TOKEN}`, '/p/:token'],
    [`/m/${TOKEN}/published`, '/m/:token/published'],
    ['/w/x', '/w/:token'],
    [`/c/${TOKEN}/did/yes`, '/c/:token/did/yes'],
    ['/', '/'],
    ['/static/app.css', '/static/app.css'],
  ])('%s becomes %s', (input, expected) => {
    expect(redactPath(input)).toBe(expected);
  });
});

describe('request logger', () => {
  let lines: Record<string, unknown>[];
  beforeEach(() => {
    lines = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      for (const l of String(chunk).split('\n').filter(Boolean)) {
        try {
          lines.push(JSON.parse(l));
        } catch {
          // not a log line
        }
      }
      return true;
    }) as typeof process.stdout.write);
  });
  afterEach(() => vi.restoreAllMocks());

  const app = () => createApp(testDeps(), { baseUrl: 'https://calvin.test' });
  const requests = () => lines.filter((l) => l.msg === 'request');

  it('logs one redacted request line without the token or query string', async () => {
    const token = newToken();
    await app().request('/p/' + token + '?n=Mia');
    expect(requests()).toHaveLength(1);
    const line = requests()[0]!;
    expect(line.path).toBe('/p/:token');
    expect(line.method).toBe('GET');
    expect(line.status).toBe(404);
    expect(typeof line.durationMs).toBe('number');
    const all = JSON.stringify(lines);
    expect(all).not.toContain(token);
    expect(all).not.toContain('Mia');
  });

  it('redacts a malformed token too', async () => {
    await app().request('/p/short');
    expect(requests()[0]!.path).toBe('/p/:token');
  });

  it('does not log /healthz', async () => {
    await app().request('/healthz');
    expect(requests()).toHaveLength(0);
  });
});
