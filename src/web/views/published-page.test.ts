import { describe, expect, it } from 'vitest';
import { publishedPage } from './published-page.ts';

const render = (emailed: boolean) =>
  String(
    publishedPage({
      publicLink: 'https://example.test/p/tok',
      manageLink: 'https://example.test/m/secret',
      manageUrl: 'https://example.test/m/secret',
      emailed,
      shareText: 'Join us',
    }),
  );

describe('publishedPage', () => {
  it('labels the link input', () => {
    expect(render(true)).toContain('<label for="public-link">Link to share</label>');
  });

  it('puts the read-only input and Copy button inside the linkbox', () => {
    const body = render(true);
    const start = body.indexOf('class="linkbox"');
    expect(start).toBeGreaterThan(-1);
    const box = body.slice(start, body.indexOf('</div>', start));
    expect(box).toContain('<input');
    expect(box).toContain('readonly');
    expect(box).toContain('id="public-link"');
    expect(box).toContain('<button');
    expect(box).toContain('id="copy"');
    expect(box).toMatch(/id="copy"[^>]*>\s*Copy\s*<\/button>/);
    expect(box).toContain('btn btn-primary');
  });

  it('renders Share as a hidden secondary button', () => {
    const body = render(true);
    const m = body.match(/<button[^>]*id="share"[^>]*>/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('btn btn-secondary');
    expect(m![0]).toContain('hidden');
  });

  it('keeps the copy-status live region', () => {
    expect(render(true)).toContain('id="copy-status" aria-live="polite"');
  });

  it('renders the manage link as a quiet link', () => {
    expect(render(true)).toContain('<a class="quiet" href="https://example.test/m/secret">Manage your plan</a>');
  });

  it('emailed: single box and manage link (AC2)', () => {
    const body = render(true);
    expect(body.match(/class="linkbox"/g)).toHaveLength(1);
    expect(body).toContain("We've emailed you a private link to manage the plan. Keep it to yourself.");
    expect(body).toContain('<a class="quiet" href="https://example.test/m/secret">Manage your plan</a>');
    expect(body).not.toContain('id="manage-link"');
    expect(body).not.toContain('Your private link');
  });

  it('failed email: private link box (AC1)', () => {
    const body = render(false);
    expect(body).toContain(
      "We couldn't email you your private link. Copy it now and keep it somewhere safe: it's the only way to manage the plan.",
    );
    expect(body).toContain('<label for="manage-link">Your private link</label>');
    expect(body).toMatch(/<input[^>]*id="manage-link"[^>]*value="https:\/\/example\.test\/m\/secret"/);
    const button = body.match(/<button[^>]*id="copy-manage"[^>]*>\s*Copy\s*<\/button>/);
    expect(button).not.toBeNull();
    expect(button![0]).toContain('btn btn-secondary');
    expect(body).not.toContain('Bookmark');
    expect(body).not.toContain('Manage your plan');
  });

  describe('copy script contract', () => {
    const copyPairs = (body: string) =>
      [...body.matchAll(/<div class="linkbox">([\s\S]*?)<\/div>/g)].flatMap((box) =>
        [...box[1]!.matchAll(/<button[^>]*data-copy="([^"]+)"/g)].map((button) => ({
          target: button[1]!,
          inBox: new RegExp(`<input[^>]*id="${button[1]!}"`).test(box[1]!),
        })),
      );

    it('failed email: each Copy button names an input in its own box', () => {
      expect(copyPairs(render(false))).toEqual([
        { target: 'public-link', inBox: true },
        { target: 'manage-link', inBox: true },
      ]);
      expect(render(false).match(/data-copy=/g)).toHaveLength(2);
    });

    it('emailed: exactly one Copy button', () => {
      expect(copyPairs(render(true))).toEqual([{ target: 'public-link', inBox: true }]);
      expect(render(true).match(/data-copy=/g)).toHaveLength(1);
    });
  });
});
