export type Source = { file: string; text: string };

const STRING = String.raw`(['"\`])((?:(?!\1)[^\\]|\\.)*)\1`;

type Naming = { names: string[]; fixtures: string[] };

// The strings in a replay test that can name an id: its name, and each
// string literal passed to loadHistory(.
function namingStrings(block: string): Naming {
  const name = new RegExp(`^\\s*${STRING}`).exec(block);
  const fixtures = [...block.matchAll(new RegExp(`loadHistory\\(\\s*${STRING}`, 'g'))];
  return { names: name ? [name[2]!] : [], fixtures: fixtures.map((m) => m[2]!) };
}

const escape = (s: string): string => s.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');

// In a test name an id must stand alone. A fixture name is kebab-case and
// may lead up to the id ("before-call-off-3-5"), so a "-" may precede it there.
const inName = (id: string): RegExp => new RegExp(`(?<![\\w-])${escape(id)}(?![\\w-])`);
const inFixture = (id: string): RegExp => new RegExp(`(?<!\\w)${escape(id)}(?![\\w-])`);

// Blank out // and /* */ comments, leaving string literals (and newlines) intact.
function stripComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; ) {
    const c = text[i]!;
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (text.startsWith('//', i) || text.startsWith('/*', i)) {
      const end = text.startsWith('//', i) ? text.indexOf('\n', i) : text.indexOf('*/', i) + 1;
      const stop = end <= i ? text.length : text.startsWith('//', i) ? end : end + 1;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

// The text after each plain it( or test( that calls runReplayHistory(. A
// variant such as it.skip( or it.each( ends the previous block but is not kept.
function replayBlocks(text: string): string[] {
  const parts = text.split(/^[ \t]*((?:it|test)(?:\.\w+)*)\(/m);
  const blocks: string[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    if (/^(it|test)$/.test(parts[i]!) && parts[i + 1]!.includes('runReplayHistory(')) {
      blocks.push(parts[i + 1]!);
    }
  }
  return blocks;
}

export function patchedIdProblems(workflows: Source[], tests: Source[]): string[] {
  const ids = new Set<string>();
  for (const { text } of workflows) {
    for (const match of text.matchAll(/patched\('([^']+)'\)/g)) ids.add(match[1]!);
  }
  const named = tests
    .filter(({ file }) => /(^|\/)tests\/workflow\//.test(file))
    .flatMap(({ text }) => replayBlocks(stripComments(text)).map(namingStrings));
  return [...ids]
    .filter(
      (id) =>
        !named.some(
          ({ names, fixtures }) =>
            names.some((s) => inName(id).test(s)) || fixtures.some((s) => inFixture(id).test(s)),
        ),
    )
    .map((id) => `patched('${id}') has no replay test naming it`);
}
