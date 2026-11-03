import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { defaultDeadline } from '../../domain/plan-rules.ts';
import { publish } from '../../domain/plans.ts';
import { loadSuggestion, recordSuggestion } from '../../domain/suggestions.ts';
import { localToInstant } from '../../domain/time.ts';
import { log } from '../../log.ts';
import { suggest } from '../../suggest/suggest.ts';
import type { AppConfig, AppDeps } from '../app.ts';
import { publishFormSchema, suggestFormSchema } from '../forms.ts';
import { createPage, FALLBACK_NOTICE, type CreateState, type FieldErrors, type FormValues } from '../views/create-page.ts';
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

async function enteredValues(c: Context): Promise<FormValues> {
  const entered = await c.req.parseBody();
  const values: FormValues = {};
  for (const [key, value] of Object.entries(entered)) if (typeof value === 'string') values[key] = value;
  return values;
}

/** The card when the form came from an ok suggestion, the fallback when it came from the publish form, else the inputs. */
async function stateFor(deps: Pick<AppDeps, 'db'>, values: FormValues): Promise<CreateState> {
  const suggestion = await loadSuggestion(deps.db, values.suggestionId ?? '');
  if (suggestion?.outcome === 'ok') return { kind: 'card', suggestion, values };
  const { city, area, timeWindow } = values;
  if (city === undefined && area === undefined && timeWindow === undefined) return { kind: 'inputs', values };
  return { kind: 'fallback', values, city: city ?? '', area: area ?? '', timeWindow: timeWindow ?? '' };
}

async function rerenderPublish(c: Context, deps: Pick<AppDeps, 'db'>, errors: FieldErrors) {
  const state = await stateFor(deps, await enteredValues(c));
  return c.html(layout('Suggest a plan', createPage(state, errors)), 422);
}

async function rerenderInputs(c: Context, errors: FieldErrors) {
  const values = await enteredValues(c);
  return c.html(layout('Suggest a plan', createPage({ kind: 'inputs', values }, errors)), 422);
}

export function createRoutes(deps: AppDeps, config: AppConfig): Hono {
  const routes = new Hono();
  routes.get('/', async (c) => {
    const suggestion = await loadSuggestion(deps.db, c.req.query('suggestion') ?? '');
    const state: CreateState =
      suggestion === null
        ? { kind: 'inputs', values: {} }
        : suggestion.outcome === 'ok'
          ? { kind: 'card', suggestion, values: {} }
          : {
              kind: 'fallback',
              values: {},
              notice: FALLBACK_NOTICE,
              city: suggestion.city,
              area: suggestion.area,
              timeWindow: suggestion.timeWindow,
            };
    return c.html(layout('Suggest a plan', createPage(state, {})));
  });
  routes.post(
    '/plans',
    zValidator('form', publishFormSchema, async (result, c) => {
      if (result.success) return undefined;
      const errors = schemaErrors(result.error.issues);
      const raw = await c.req.parseBody();
      const timing = timingErrors(deps, timingInput(raw, new Set(Object.keys(errors))));
      return rerenderPublish(c, deps, { ...timing, ...errors });
    }),
    async (c) => {
      const form = c.req.valid('form');
      const errors = timingErrors(deps, form);
      if (Object.keys(errors).length > 0) return rerenderPublish(c, deps, errors);
      const { manageToken } = await publish(deps, form);
      return c.redirect(`/m/${manageToken}/published`, 303);
    },
  );
  routes.post(
    '/suggest',
    zValidator('form', suggestFormSchema, (result, c) =>
      result.success ? undefined : rerenderInputs(c, schemaErrors(result.error.issues)),
    ),
    async (c) => {
      const form = c.req.valid('form');
      const result = await suggest(form, {
        suggestPlanCall: deps.suggestPlanCall,
        now: deps.now,
        model: config.anthropicModel,
      });
      if (result.outcome === 'failed') log.warn('suggestion failed', { failureReason: result.failureReason });
      const id = await recordSuggestion(deps, form, result);
      return c.redirect(`/?suggestion=${id}`, 303);
    },
  );
  return routes;
}
