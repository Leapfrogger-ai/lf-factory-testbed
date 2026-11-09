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

export function patchedIdProblems(workflows: Source[], tests: Source[]): string[] {
  const ids = new Set<string>();
  for (const { text } of workflows) {
    for (const match of text.matchAll(/patched\('([^']+)'\)/g)) ids.add(match[1]!);
  }
  const named = tests
    .filter(({ file }) => /(^|\/)tests\/workflow\//.test(file))
    .flatMap(({ text }) =>
    text
      .split(/^[ \t]*(?:it|test)\(/m)
      .slice(1)
      .filter((block) => block.includes('runReplayHistory('))
      .map(namingStrings),
  );
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
