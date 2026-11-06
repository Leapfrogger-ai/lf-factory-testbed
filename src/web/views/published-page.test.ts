import { describe, expect, it } from 'vitest';
import { publishedPage } from './published-page.ts';

const render = (emailed: boolean) =>
  String(
    publishedPage({
      publicLink: 'https://example.test/p/tok',
      manageLink: 'https://example.test/m/secret',
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

  it('renders both emailed variants', () => {
    expect(render(true)).toContain("We've emailed you a private link to manage the plan. Keep it to yourself.");
    expect(render(false)).toContain(
      "We couldn't email you your private link. Bookmark the link below to manage the plan.",
    );
  });
});
