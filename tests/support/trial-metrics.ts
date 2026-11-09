import { readFileSync } from 'node:fs';

const SCHEMA_DOC = new URL('../../specs/calvin-5/database-schema.md', import.meta.url);
const HEADING = '## Trial metric queries';

// The statements of the first ```sql block after the "Trial metric queries" heading.
export function trialQueries(): string[] {
  const text = readFileSync(SCHEMA_DOC, 'utf8');
  const headingAt = text.indexOf(HEADING);
  if (headingAt === -1) throw new Error(`no "${HEADING}" heading in database-schema.md`);
  const afterHeading = text.slice(headingAt);
  const open = afterHeading.indexOf('```sql');
  if (open === -1) throw new Error('no sql block after the Trial metric queries heading');
  const body = afterHeading.slice(open + '```sql'.length);
  const close = body.indexOf('```');
  if (close === -1) throw new Error('the sql block is not closed');
  return body
    .slice(0, close)
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');
}

// The one statement containing the marker.
export function trialQuery(marker: string): string {
  const matches = trialQueries().filter((statement) => statement.includes(marker));
  if (matches.length !== 1) {
    throw new Error(`expected exactly one trial query containing "${marker}", found ${matches.length}`);
  }
  return matches[0]!;
}
