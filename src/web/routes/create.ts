import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { defaultDeadline } from '../../domain/plan-rules.ts';
import { publish } from '../../domain/plans.ts';
import { localToInstant } from '../../domain/time.ts';
import type { AppDeps } from '../app.ts';
import { publishFormSchema, type PublishForm } from '../forms.ts';
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

function timingErrors(deps: Pick<AppDeps, 'now'>, form: PublishForm): FieldErrors {
  const errors: FieldErrors = {};
  const now = deps.now();
  const gatheringAt = localToInstant(form.date, form.time);
  const gatheringOk = Temporal.Instant.compare(gatheringAt, now) > 0;
  if (!gatheringOk) errors.date = 'The gathering needs to be in the future.';

  if (form.deadlineDate !== undefined && form.deadlineTime !== undefined) {
    const deadlineAt = localToInstant(form.deadlineDate, form.deadlineTime);
    if (Temporal.Instant.compare(deadlineAt, now) <= 0) {
      errors.deadlineDate = 'The decide-by time needs to be in the future.';
    } else if (Temporal.Instant.compare(deadlineAt, gatheringAt) >= 0) {
      errors.deadlineDate = 'The decide-by time needs to be before the gathering.';
    }
  } else if (gatheringOk) {
    const deadlineAt = defaultDeadline(now, gatheringAt);
    if (Temporal.Instant.compare(deadlineAt, now) <= 0) {
      errors.date = 'The gathering needs to be in the future.';
    }
  }
  return errors;
}

export function createRoutes(deps: AppDeps): Hono {
  const routes = new Hono();
  routes.post(
    '/plans',
    zValidator('form', publishFormSchema, async (result, c) => {
      if (result.success) return undefined;
      const entered = await c.req.parseBody();
      const values: FormValues = {};
      for (const [key, value] of Object.entries(entered)) if (typeof value === 'string') values[key] = value;
      return c.html(layout('Suggest a plan', createPage(values, schemaErrors(result.error.issues))), 422);
    }),
    async (c) => {
      const form = c.req.valid('form');
      const errors = timingErrors(deps, form);
      if (Object.keys(errors).length > 0) {
        const entered = await c.req.parseBody();
        const values: FormValues = {};
        for (const [key, value] of Object.entries(entered)) if (typeof value === 'string') values[key] = value;
        return c.html(layout('Suggest a plan', createPage(values, errors)), 422);
      }
      const { manageToken } = await publish(deps, form);
      return c.redirect(`/m/${manageToken}/published`, 303);
    },
  );
  return routes;
}
