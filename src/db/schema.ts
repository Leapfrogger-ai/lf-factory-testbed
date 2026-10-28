import { sql } from 'drizzle-orm';
import {
  pgTable, uuid, text, integer, boolean, timestamp, bigint, jsonb,
  check, unique, uniqueIndex, index, primaryKey, type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { EventData } from '../domain/events.ts';

const instant = (name: string) => timestamp(name, { withTimezone: true });
const TOKEN = sql`'^[A-Za-z0-9_-]{43}$'`;

export const suggestions = pgTable('suggestions', {
  id: uuid().primaryKey().defaultRandom(),
  previousSuggestionId: uuid().references((): AnyPgColumn => suggestions.id, { onDelete: 'set null' }),
  city: text().notNull(),
  area: text().notNull(),
  timeWindow: text().notNull(),
  outcome: text({ enum: ['ok', 'failed'] }).notNull(),
  failureReason: text({ enum: ['timeout', 'api_error', 'no_proposal', 'pause_turn', 'refusal', 'max_tokens', 'invalid_proposal'] }),
  format: text(),
  venue: text(),
  venueAddress: text(),
  venueUrl: text(),
  gatheringAt: instant('gathering_at'),
  minimum: integer(),
  commitDeadlineAt: instant('commit_deadline_at'),
  latencyMs: integer().notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_suggestions_previous_suggestion_id').on(t.previousSuggestionId),
  check('suggestions_city_check', sql`char_length(${t.city}) BETWEEN 1 AND 60`),
  check('suggestions_area_check', sql`char_length(${t.area}) BETWEEN 1 AND 200`),
  check('suggestions_time_window_check', sql`char_length(${t.timeWindow}) BETWEEN 1 AND 200`),
  check('suggestions_outcome_check', sql`${t.outcome} IN ('ok', 'failed')`),
  check('suggestions_failure_reason_present_check', sql`(${t.outcome} = 'failed') = (${t.failureReason} IS NOT NULL)`),
  check('suggestions_failure_reason_check', sql`${t.failureReason} IN ('timeout', 'api_error', 'no_proposal', 'pause_turn', 'refusal', 'max_tokens', 'invalid_proposal')`),
  check('suggestions_ok_fields_check', sql`${t.outcome} = 'failed' OR (${t.format} IS NOT NULL AND ${t.venue} IS NOT NULL AND ${t.gatheringAt} IS NOT NULL AND ${t.minimum} IS NOT NULL AND ${t.commitDeadlineAt} IS NOT NULL)`),
  check('suggestions_format_check', sql`char_length(${t.format}) BETWEEN 1 AND 40`),
  check('suggestions_venue_check', sql`char_length(${t.venue}) BETWEEN 1 AND 120`),
  check('suggestions_venue_address_check', sql`char_length(${t.venueAddress}) BETWEEN 1 AND 200`),
  check('suggestions_venue_url_check', sql`char_length(${t.venueUrl}) BETWEEN 1 AND 2048`),
  check('suggestions_minimum_check', sql`${t.minimum} >= 2`),
  check('suggestions_latency_ms_check', sql`${t.latencyMs} >= 0`),
]);

export const plans = pgTable('plans', {
  id: uuid().primaryKey().defaultRandom(),
  publicToken: text().notNull().unique('plans_public_token_key'),
  manageToken: text().notNull().unique('plans_manage_token_key'),
  checkInToken: text().notNull().unique('plans_check_in_token_key'),
  suggestionId: uuid().references(() => suggestions.id, { onDelete: 'set null' }),
  suggestionEdited: boolean(),
  fromPlanId: uuid().references((): AnyPgColumn => plans.id, { onDelete: 'set null' }),
  city: text().notNull(),
  area: text().notNull(),
  timeWindow: text().notNull(),
  format: text().notNull(),
  venue: text().notNull(),
  gatheringAt: instant('gathering_at').notNull(),
  commitDeadlineAt: instant('commit_deadline_at').notNull(),
  minimum: integer().notNull(),
  state: text({ enum: ['open', 'confirmed', 'called_off'] }).notNull().default('open'),
  confirmedAt: instant('confirmed_at'),
  calledOffAt: instant('called_off_at'),
  calledOffReason: text({ enum: ['deadline', 'creator'] }),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_plans_suggestion_id').on(t.suggestionId),
  index('idx_plans_from_plan_id').on(t.fromPlanId),
  check('plans_public_token_check', sql`${t.publicToken} ~ ${TOKEN}`),
  check('plans_manage_token_check', sql`${t.manageToken} ~ ${TOKEN}`),
  check('plans_check_in_token_check', sql`${t.checkInToken} ~ ${TOKEN}`),
  check('plans_city_check', sql`char_length(${t.city}) BETWEEN 1 AND 60`),
  check('plans_area_check', sql`char_length(${t.area}) BETWEEN 1 AND 200`),
  check('plans_time_window_check', sql`char_length(${t.timeWindow}) BETWEEN 1 AND 200`),
  check('plans_format_check', sql`char_length(${t.format}) BETWEEN 1 AND 40`),
  check('plans_venue_check', sql`char_length(${t.venue}) BETWEEN 1 AND 120`),
  check('plans_minimum_check', sql`${t.minimum} >= 2`),
  check('plans_deadline_before_gathering_check', sql`${t.commitDeadlineAt} < ${t.gatheringAt}`),
  check('plans_state_check', sql`${t.state} IN ('open', 'confirmed', 'called_off')`),
  check('plans_called_off_reason_check', sql`${t.calledOffReason} IN ('deadline', 'creator')`),
  check('plans_state_timestamps_check', sql`
       (${t.state} = 'open'       AND ${t.confirmedAt} IS NULL     AND ${t.calledOffAt} IS NULL     AND ${t.calledOffReason} IS NULL)
    OR (${t.state} = 'confirmed'  AND ${t.confirmedAt} IS NOT NULL AND ${t.calledOffAt} IS NULL     AND ${t.calledOffReason} IS NULL)
    OR (${t.state} = 'called_off' AND ${t.calledOffAt} IS NOT NULL AND ${t.calledOffReason} IS NOT NULL
        AND (${t.calledOffReason} = 'creator' OR ${t.confirmedAt} IS NULL))`),
]);

export const commits = pgTable('commits', {
  id: uuid().primaryKey().defaultRandom(),
  planId: uuid().notNull().references(() => plans.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  email: text().notNull(),
  emailNormalized: text().notNull(),
  isCreator: boolean().notNull().default(false),
  withdrawToken: text().notNull().unique('commits_withdraw_token_key'),
  withdrawnAt: instant('withdrawn_at'),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique('commits_plan_id_email_normalized_key').on(t.planId, t.emailNormalized),
  uniqueIndex('commits_one_creator_per_plan').on(t.planId).where(sql`${t.isCreator}`),
  check('commits_name_check', sql`char_length(${t.name}) BETWEEN 1 AND 80`),
  check('commits_email_check', sql`char_length(${t.email}) BETWEEN 3 AND 254`),
  check('commits_email_normalized_check', sql`${t.emailNormalized} = lower(${t.email})`),
  check('commits_withdraw_token_check', sql`${t.withdrawToken} ~ ${TOKEN}`),
  check('commits_creator_never_withdrawn_check', sql`NOT (${t.isCreator} AND ${t.withdrawnAt} IS NOT NULL)`),
]);

export const emailSends = pgTable('email_sends', {
  commitId: uuid().notNull().references(() => commits.id, { onDelete: 'cascade' }),
  kind: text({ enum: ['manage_link', 'confirmed', 'reminder_24h', 'reminder_morning', 'not_this_time', 'check_in'] }).notNull(),
  resendId: text(),
  createdAt: instant('created_at').notNull().defaultNow(),
  sentAt: instant('sent_at'),
}, (t) => [
  primaryKey({ columns: [t.commitId, t.kind] }),
  check('email_sends_kind_check', sql`${t.kind} IN ('manage_link', 'confirmed', 'reminder_24h', 'reminder_morning', 'not_this_time', 'check_in')`),
  check('email_sends_sent_check', sql`(${t.sentAt} IS NULL) = (${t.resendId} IS NULL)`),
  check('email_sends_resend_id_check', sql`char_length(${t.resendId}) BETWEEN 1 AND 100`),
]);

export const checkInAnswers = pgTable('check_in_answers', {
  planId: uuid().notNull().references(() => plans.id, { onDelete: 'cascade' }),
  question: text({ enum: ['happened', 'attended'] }).notNull(),
  answer: boolean().notNull(),
  answeredAt: instant('answered_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.planId, t.question] }),
  check('check_in_answers_question_check', sql`${t.question} IN ('happened', 'attended')`),
]);

export const events = pgTable('events', {
  id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  planId: uuid().notNull().references(() => plans.id, { onDelete: 'cascade' }),
  commitId: uuid().references(() => commits.id, { onDelete: 'cascade' }),
  type: text({ enum: ['plan.published', 'commit.added', 'commit.withdrawn', 'plan.confirmed', 'plan.called_off', 'email.sent', 'check_in.answered'] }).notNull(),
  data: jsonb().$type<EventData['data']>().notNull().default(sql`'{}'::jsonb`),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_events_plan_id_created_at').on(t.planId, t.createdAt),
  index('idx_events_commit_id').on(t.commitId),
  check('events_type_check', sql`${t.type} IN ('plan.published', 'commit.added', 'commit.withdrawn', 'plan.confirmed', 'plan.called_off', 'email.sent', 'check_in.answered')`),
  check('events_commit_id_check', sql`(${t.type} IN ('commit.added', 'commit.withdrawn', 'email.sent')) = (${t.commitId} IS NOT NULL)`),
  check('events_data_object_check', sql`jsonb_typeof(${t.data}) = 'object'`),
]);
