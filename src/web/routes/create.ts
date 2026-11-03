import { zValidator } from '@hono/zod-validator';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { HtmlEscapedString } from 'hono/utils/html';
import { deadlineIsStale, defaultDeadline } from '../../domain/plan-rules.ts';
import { loadSendTarget, publish } from '../../domain/plans.ts';
import { loadSuggestion, recordSuggestion, type Suggestion } from '../../domain/suggestions.ts';
import { localToInstant } from '../../domain/time.ts';
import { sendOnce } from '../../email/send.ts';
import { log } from '../../log.ts';
import { suggest } from '../../suggest/suggest.ts';
import type { AppConfig, AppDeps } from '../app.ts';
import { clientIp } from '../client-ip.ts';
import { schemaErrors } from '../field-errors.ts';
import { publishFormSchema, suggestFormSchema } from '../forms.ts';
import type { RateLimiter, RateRoute } from '../rate-limit.ts';
import {
  createPage,
  FALLBACK_NOTICE,
  PUBLISH_LIMIT_NOTICE,
  SUGGEST_LIMIT_NOTICE,
  type CreateState,
  type FieldErrors,
  type FormValues,
} from '../views/create-page.ts';
import { layout } from '../views/layout.ts';

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

type OkSuggestion = Extract<Suggestion, { outcome: 'ok' }>;

/** The stored ok suggestion for the id, or undefined for no id, a malformed or unknown one, or a failed row. */
async function okSuggestion(deps: Pick<AppDeps, 'db'>, id: string | undefined): Promise<OkSuggestion | undefined> {
  const suggestion = await loadSuggestion(deps.db, id ?? '');
  return suggestion?.outcome === 'ok' ? suggestion : undefined;
}

/** R3 rule 3: drops the deadline fields when they are the suggestion's but When changed, so the default applies. */
function withoutStaleDeadline(input: TimingInput, suggestion: OkSuggestion | undefined): TimingInput {
  const { date, time, deadlineDate, deadlineTime } = input;
  if (
    suggestion === undefined ||
    date === undefined ||
    time === undefined ||
    deadlineDate === undefined ||
    deadlineTime === undefined
  ) {
    return input;
  }
  const stale = deadlineIsStale(
    { gatheringAt: localToInstant(date, time), deadlineAt: localToInstant(deadlineDate, deadlineTime) },
    suggestion,
  );
  return stale ? { date, time } : input;
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

/** The create page with create.js loaded under the response's CSP nonce. */
function createLayout(c: Context, body: HtmlEscapedString, status?: 422) {
  const nonce = c.get('secureHeadersNonce') as string;
  const page = layout('Suggest a plan', body, { script: { src: '/static/create.js', nonce } });
  return status === undefined ? c.html(page) : c.html(page, status);
}

async function rerenderPublish(c: Context, deps: Pick<AppDeps, 'db'>, errors: FieldErrors) {
  const state = await stateFor(deps, await enteredValues(c));
  return createLayout(c, createPage(state, errors), 422);
}

async function rerenderInputs(c: Context, errors: FieldErrors) {
  const values = await enteredValues(c);
  // Kept as entered so Change still links the next suggestion; it is checked again on the next submit.
  const previous = values.previousSuggestionId?.trim();
  const state: CreateState =
    previous ? { kind: 'inputs', values, previousSuggestionId: previous } : { kind: 'inputs', values };
  return createLayout(c, createPage(state, errors), 422);
}

/** Counts the request against the route's limits; answers 429 with Retry-After when over. */
function limit(
  limiter: RateLimiter,
  route: RateRoute,
  render429: (c: Context) => Response | Promise<Response>,
): MiddlewareHandler {
  return async (c, next) => {
    const decision = limiter.check(route, clientIp(c));
    if (!decision.limited) return next();
    c.header('Retry-After', String(decision.retryAfterSeconds));
    log.warn('rate limited', { route });
    return render429(c);
  };
}

async function renderSuggestLimited(c: Context) {
  const { city, area, timeWindow, ...rest } = await enteredValues(c);
  const state: CreateState = {
    kind: 'fallback',
    values: { city: city ?? '', area: area ?? '', timeWindow: timeWindow ?? '', ...rest },
    notice: SUGGEST_LIMIT_NOTICE,
    city: city ?? '',
    area: area ?? '',
    timeWindow: timeWindow ?? '',
  };
  return c.html(layout('Suggest a plan', createPage(state, {})), 429);
}

async function renderPublishLimited(c: Context, deps: Pick<AppDeps, 'db'>) {
  const state: CreateState = { ...(await stateFor(deps, await enteredValues(c))), notice: PUBLISH_LIMIT_NOTICE };
  return c.html(layout('Suggest a plan', createPage(state, {})), 429);
}

export function createRoutes(deps: AppDeps, config: AppConfig, limiter: RateLimiter): Hono {
  const routes = new Hono();
  routes.get('/', async (c) => {
    const suggestion = await loadSuggestion(deps.db, c.req.query('suggestion') ?? '');
    const changing = c.req.query('change') === '1';
    const state: CreateState =
      suggestion === null
        ? { kind: 'inputs', values: {} }
        : changing
          ? {
              kind: 'inputs',
              values: { city: suggestion.city, area: suggestion.area, timeWindow: suggestion.timeWindow },
              previousSuggestionId: suggestion.id,
            }
          : suggestion.outcome === 'ok'
            ? { kind: 'card', suggestion, values: {} }
            : {
                kind: 'fallback',
                values: {},
                notice: FALLBACK_NOTICE,
                city: suggestion.city,
                area: suggestion.area,
                timeWindow: suggestion.timeWindow,
                previousSuggestionId: suggestion.id,
              };
    return createLayout(c, createPage(state, {}));
  });
  routes.post(
    '/plans',
    limit(limiter, 'publish', (c) => renderPublishLimited(c, deps)),
    zValidator('form', publishFormSchema, async (result, c) => {
      if (result.success) return undefined;
      const errors = schemaErrors(result.error.issues);
      const raw = await c.req.parseBody();
      const suggestionId = typeof raw.suggestionId === 'string' ? raw.suggestionId.trim() : undefined;
      const suggestion = await okSuggestion(deps, suggestionId);
      const timing = timingErrors(
        deps,
        withoutStaleDeadline(timingInput(raw, new Set(Object.keys(errors))), suggestion),
      );
      return rerenderPublish(c, deps, { ...timing, ...errors });
    }),
    async (c) => {
      const form = c.req.valid('form');
      const suggestion = await okSuggestion(deps, form.suggestionId);
      const errors = timingErrors(deps, withoutStaleDeadline(form, suggestion));
      if (Object.keys(errors).length > 0) return rerenderPublish(c, deps, errors);
      const { planId, manageToken } = await publish(deps, form, suggestion);
      try {
        const { plan, commit } = await loadSendTarget(deps.db, planId);
        await sendOnce({ db: deps.db, sendEmail: deps.sendEmail, baseUrl: config.baseUrl }, 'manage_link', plan, commit);
      } catch (err) {
        // The name only: a provider message can carry the creator's address.
        log.error('manage-link email failed', { planId, errorName: err instanceof Error ? err.name : 'unknown' });
      }
      return c.redirect(`/m/${manageToken}/published`, 303);
    },
  );
  routes.post(
    '/suggest',
    limit(limiter, 'suggest', renderSuggestLimited),
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
      const previous = await loadSuggestion(deps.db, form.previousSuggestionId ?? '');
      const id = await recordSuggestion(deps, form, result, previous?.id ?? null);
      return c.redirect(`/?suggestion=${id}`, 303);
    },
  );
  return routes;
}
