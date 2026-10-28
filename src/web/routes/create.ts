import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { defaultDeadline } from '../../domain/plan-rules.ts';
import { publish } from '../../domain/plans.ts';
import { localToInstant } from '../../domain/time.ts';
import type { AppDeps } from '../app.ts';
import { publishFormSchema } from '../forms.ts';
import { createPage, type FieldErrors, type FormValues } from '../views/create-page.ts';
import { layout } from '../views/layout.ts';

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

function schemaErrors(issues: readonly Issue[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? '');
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

type TimingInput = { date?: string; time?: string; deadlineDate?: string; deadlineTime?: string };

function timingErrors(deps: Pick<AppDeps, 'now'>, input: TimingInput): FieldErrors {
  const errors: FieldErrors = {};
  if (input.date === undefined || input.time === undefined) return errors;
  const now = deps.now();
  const gatheringAt = localToInstant(input.date, input.time);
  const gatheringOk = Temporal.Instant.compare(gatheringAt, now) > 0;
  if (!gatheringOk) errors.date = 'The gathering needs to be in the future.';

  if (input.deadlineDate !== undefined && input.deadlineTime !== undefined) {
    const deadlineAt = localToInstant(input.deadlineDate, input.deadlineTime);
    if (Temporal.Instant.compare(deadlineAt, now) <= 0) {
      errors.deadlineDate = 'The decide-by time needs to be in the future.';
    } else if (Temporal.Instant.compare(deadlineAt, gatheringAt) >= 0) {
      errors.deadlineDate = 'The decide-by time needs to be before the gathering.';
    }
  } else if (gatheringOk && input.deadlineDate === undefined && input.deadlineTime === undefined) {
    const deadlineAt = defaultDeadline(now, gatheringAt);
    if (Temporal.Instant.compare(deadlineAt, now) <= 0) {
      errors.date = 'The gathering needs to be in the future.';
    }
  }
  return errors;
}

/** The timing inputs that parsed on their own, so their checks can join the schema errors. */
function timingInput(values: Record<string, unknown>, invalid: ReadonlySet<string>): TimingInput {
  const pick = (field: string): string | undefined => {
    const value = values[field];
    if (invalid.has(field) || typeof value !== 'string' || value.trim() === '') return undefined;
    return value.trim();
  };
  return { date: pick('date'), time: pick('time'), deadlineDate: pick('deadlineDate'), deadlineTime: pick('deadlineTime') };
}

async function rerender(c: Context, errors: FieldErrors) {
  const entered = await c.req.parseBody();
  const values: FormValues = {};
  for (const [key, value] of Object.entries(entered)) if (typeof value === 'string') values[key] = value;
  return c.html(layout('Suggest a plan', createPage(values, errors)), 422);
}

export function createRoutes(deps: AppDeps): Hono {
  const routes = new Hono();
  routes.get('/', (c) => c.html(layout('Suggest a plan', createPage({}, {}))));
  routes.post(
    '/plans',
    zValidator('form', publishFormSchema, async (result, c) => {
      if (result.success) return undefined;
      const errors = schemaErrors(result.error.issues);
      const raw = await c.req.parseBody();
      const timing = timingErrors(deps, timingInput(raw, new Set(Object.keys(errors))));
      return rerender(c, { ...timing, ...errors });
    }),
    async (c) => {
      const form = c.req.valid('form');
      const errors = timingErrors(deps, form);
      if (Object.keys(errors).length > 0) return rerender(c, errors);
      const { manageToken } = await publish(deps, form);
      return c.redirect(`/m/${manageToken}/published`, 303);
    },
  );
  return routes;
}
