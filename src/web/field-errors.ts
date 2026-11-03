import type { FieldErrors } from './views/create-page.ts';

const MISSING: Record<string, string> = {
  city: 'Pick a city.',
  area: 'Add a rough area.',
  timeWindow: 'Add a rough time.',
  format: 'Say what it is, like coffee or a walk.',
  venue: 'Add where it is.',
  date: 'Pick a date.',
  time: 'Pick a time.',
  minimum: 'The minimum is at least 2 people, you included.',
  deadlineDate: 'Pick both a date and a time, or leave both empty.',
  deadlineTime: 'Pick both a date and a time, or leave both empty.',
  name: 'Add your name.',
  email: "That email doesn't look right.",
};

type Issue = { path: PropertyKey[]; code: string; message: string; maximum?: unknown };

export function schemaErrors(issues: readonly Issue[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const named = String(issue.path[0] ?? '');
    const field = issue.code === 'custom' && named === 'deadlineTime' ? 'deadlineDate' : named;
    if (field === '' || errors[field] !== undefined) continue;
    errors[field] =
      issue.code === 'too_big' && typeof issue.maximum === 'number' && field !== 'minimum'
        ? `Keep it under ${issue.maximum} characters.`
        : issue.code === 'custom' && issue.message.startsWith('Give both')
          ? 'Pick both a date and a time, or leave both empty.'
          : (MISSING[field] ?? 'Check this field.');
  }
  return errors;
}
