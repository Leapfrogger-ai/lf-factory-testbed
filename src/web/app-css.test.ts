import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../public/app.css', import.meta.url), 'utf8');

// Hex literals typed from ux-spec section 4.1: [token, light, dark].
const TOKENS: Array<[string, string, string]> = [
  ['--paper', '#F5F3F8', '#1A1720'],
  ['--surface', '#FFFFFF', '#24202B'],
  ['--ink', '#24202E', '#F2EFF6'],
  ['--ink-2', '#4E4760', '#CBC4D8'],
  ['--muted', '#645C75', '#A79FB5'],
  ['--line', '#DDD8E5', '#3A3445'],
  ['--line-strong', '#8A8199', '#7F7792'],
  ['--berry', '#8A2F6F', '#E59BCB'],
  ['--berry-press', '#6F2459', '#F0B8DB'],
  ['--berry-tint', '#F6E3EF', '#3B2434'],
  ['--on-accent', '#FFFFFF', '#1A1720'],
  ['--on', '#2B6A45', '#8FCBA5'],
  ['--on-tint', '#E2F0E6', '#1F3329'],
  ['--off-tint', '#E8E5ED', '#332E3C'],
  ['--error', '#A8321E', '#F08B76'],
  ['--strip', '#24202E', '#F2EFF6'],
  ['--strip-text', '#F5F3F8', '#1A1720'],
];

const DARK = '@media (prefers-color-scheme: dark)';

function declares(block: string, token: string, hex: string): boolean {
  const re = new RegExp(`${token}\\s*:\\s*${hex}\\b`, 'i');
  return re.test(block);
}

/** Returns each animation/transition declaration not inside a top-level reduced-motion block. */
function unguardedMotion(source: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const bad: string[] = [];
  // For each match, find its enclosing top-level block prelude with a depth counter.
  const re = /\b(animation|transition)[\w-]*\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let d = 0;
    let start = -1;
    for (let i = 0; i < m.index; i++) {
      if (text[i] === '{') {
        if (d === 0) start = i;
        d++;
      } else if (text[i] === '}') {
        d--;
      }
    }
    const prevClose = text.lastIndexOf('}', start);
    const prelude = text.slice(prevClose + 1, start).trim();
    if (!prelude.startsWith('@media (prefers-reduced-motion: no-preference)')) bad.push(m[0]);
  }
  return bad;
}

describe('public/app.css', () => {
  const rule = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`(?:^|[}/])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    return m ? m[1] : '';
  };

  const darkAt = css.indexOf(DARK);

  it('defines every ux-spec 4.1 token on :root (light) and in the dark media block', () => {
    expect(darkAt).toBeGreaterThan(-1);
    const light = css.slice(0, darkAt);
    const dark = css.slice(darkAt);
    expect(light).toMatch(/:root\s*\{/);
    for (const [token, l, d] of TOKENS) {
      expect(declares(light, token, l), `${token} light ${l}`).toBe(true);
      expect(declares(dark, token, d), `${token} dark ${d}`).toBe(true);
    }
  });

  it('has neither the old accent nor the old background', () => {
    expect(css).not.toMatch(/#B4502B/i);
    expect(css).not.toMatch(/#FBF7F2/i);
  });

  it('is at most 10,240 bytes', () => {
    expect(Buffer.byteLength(css)).toBeLessThanOrEqual(10240);
  });

  it('has no @font-face and no @import', () => {
    expect(css).not.toMatch(/@font-face/);
    expect(css).not.toMatch(/@import/);
  });

  it('puts every animation and transition inside prefers-reduced-motion: no-preference', () => {
    expect(unguardedMotion(css)).toEqual([]);
  });

  it('flags a bare transition (the helper can fail)', () => {
    expect(unguardedMotion('a { transition: color 1s; }')).toHaveLength(1);
    expect(
      unguardedMotion('@media (prefers-reduced-motion: no-preference) { a { transition: color 1s; } }'),
    ).toHaveLength(0);
  });

  it('has the Epic 5 additions (ux/epic-5.html proposed CSS)', () => {
    expect(rule('.btn[disabled]')).toMatch(/opacity:\s*0?\.65/);
    expect(rule('.btn[disabled]')).toMatch(/cursor:\s*progress/);
    expect(rule('.btn[disabled]:hover')).toMatch(/background:\s*var\(--berry\)/);
    expect(rule('input::placeholder')).toMatch(/color:\s*var\(--muted\)/);
    expect(rule('select[aria-invalid="true"]')).toMatch(/border-color:\s*var\(--error\)/);
    expect(rule('.errors')).toMatch(/list-style:\s*none/);
    expect(rule('.errors')).toMatch(/padding:\s*0/);
    expect(rule('.lede')).toMatch(/color:\s*var\(--ink-2\)/);
    for (const s of ['.context', '.context .when', '.context .kind', '.answers', '.answers .btn']) {
      expect(rule(s).trim(), s).not.toBe('');
    }
  });

  it('hides [hidden] elements even when a class sets display', () => {
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });

  it('lays the Yes and No buttons side by side, at least 48px tall', () => {
    expect(rule('.answers')).toMatch(/display:\s*flex/);
    expect(rule('.answers')).toMatch(/gap:\s*\d+px/);
    expect(rule('.answers .btn')).toMatch(/flex:\s*1\b/);
    expect(rule('.btn')).toMatch(/min-height:\s*48px/);
  });
});
