CREATE TABLE "check_in_answers" (
	"plan_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" boolean NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_in_answers_plan_id_question_pk" PRIMARY KEY("plan_id","question"),
	CONSTRAINT "check_in_answers_question_check" CHECK ("check_in_answers"."question" IN ('happened', 'attended'))
);
--> statement-breakpoint
CREATE TABLE "commits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"is_creator" boolean DEFAULT false NOT NULL,
	"withdraw_token" text NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commits_withdraw_token_key" UNIQUE("withdraw_token"),
	CONSTRAINT "commits_plan_id_email_normalized_key" UNIQUE("plan_id","email_normalized"),
	CONSTRAINT "commits_name_check" CHECK (char_length("commits"."name") BETWEEN 1 AND 80),
	CONSTRAINT "commits_email_check" CHECK (char_length("commits"."email") BETWEEN 3 AND 254),
	CONSTRAINT "commits_email_normalized_check" CHECK ("commits"."email_normalized" = lower("commits"."email")),
	CONSTRAINT "commits_withdraw_token_check" CHECK ("commits"."withdraw_token" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "commits_creator_never_withdrawn_check" CHECK (NOT ("commits"."is_creator" AND "commits"."withdrawn_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "email_sends" (
	"commit_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"resend_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "email_sends_commit_id_kind_pk" PRIMARY KEY("commit_id","kind"),
	CONSTRAINT "email_sends_kind_check" CHECK ("email_sends"."kind" IN ('manage_link', 'confirmed', 'reminder_24h', 'reminder_morning', 'not_this_time', 'check_in')),
	CONSTRAINT "email_sends_sent_check" CHECK (("email_sends"."sent_at" IS NULL) = ("email_sends"."resend_id" IS NULL)),
	CONSTRAINT "email_sends_resend_id_check" CHECK (char_length("email_sends"."resend_id") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"plan_id" uuid NOT NULL,
	"commit_id" uuid,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_type_check" CHECK ("events"."type" IN ('plan.published', 'commit.added', 'commit.withdrawn', 'plan.confirmed', 'plan.called_off', 'email.sent', 'check_in.answered')),
	CONSTRAINT "events_commit_id_check" CHECK (("events"."type" IN ('commit.added', 'commit.withdrawn', 'email.sent')) = ("events"."commit_id" IS NOT NULL)),
	CONSTRAINT "events_data_object_check" CHECK (jsonb_typeof("events"."data") = 'object')
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_token" text NOT NULL,
	"manage_token" text NOT NULL,
	"check_in_token" text NOT NULL,
	"suggestion_id" uuid,
	"suggestion_edited" boolean,
	"from_plan_id" uuid,
	"city" text NOT NULL,
	"area" text NOT NULL,
	"time_window" text NOT NULL,
	"format" text NOT NULL,
	"venue" text NOT NULL,
	"gathering_at" timestamp with time zone NOT NULL,
	"commit_deadline_at" timestamp with time zone NOT NULL,
	"minimum" integer NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"called_off_at" timestamp with time zone,
	"called_off_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_public_token_key" UNIQUE("public_token"),
	CONSTRAINT "plans_manage_token_key" UNIQUE("manage_token"),
	CONSTRAINT "plans_check_in_token_key" UNIQUE("check_in_token"),
	CONSTRAINT "plans_public_token_check" CHECK ("plans"."public_token" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "plans_manage_token_check" CHECK ("plans"."manage_token" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "plans_check_in_token_check" CHECK ("plans"."check_in_token" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "plans_city_check" CHECK (char_length("plans"."city") BETWEEN 1 AND 60),
	CONSTRAINT "plans_area_check" CHECK (char_length("plans"."area") BETWEEN 1 AND 200),
	CONSTRAINT "plans_time_window_check" CHECK (char_length("plans"."time_window") BETWEEN 1 AND 200),
	CONSTRAINT "plans_format_check" CHECK (char_length("plans"."format") BETWEEN 1 AND 40),
	CONSTRAINT "plans_venue_check" CHECK (char_length("plans"."venue") BETWEEN 1 AND 120),
	CONSTRAINT "plans_minimum_check" CHECK ("plans"."minimum" >= 2),
	CONSTRAINT "plans_deadline_before_gathering_check" CHECK ("plans"."commit_deadline_at" < "plans"."gathering_at"),
	CONSTRAINT "plans_state_check" CHECK ("plans"."state" IN ('open', 'confirmed', 'called_off')),
	CONSTRAINT "plans_called_off_reason_check" CHECK ("plans"."called_off_reason" IN ('deadline', 'creator')),
	CONSTRAINT "plans_state_timestamps_check" CHECK (
       ("plans"."state" = 'open'       AND "plans"."confirmed_at" IS NULL     AND "plans"."called_off_at" IS NULL     AND "plans"."called_off_reason" IS NULL)
    OR ("plans"."state" = 'confirmed'  AND "plans"."confirmed_at" IS NOT NULL AND "plans"."called_off_at" IS NULL     AND "plans"."called_off_reason" IS NULL)
    OR ("plans"."state" = 'called_off' AND "plans"."called_off_at" IS NOT NULL AND "plans"."called_off_reason" IS NOT NULL
        AND ("plans"."called_off_reason" = 'creator' OR "plans"."confirmed_at" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"previous_suggestion_id" uuid,
	"city" text NOT NULL,
	"area" text NOT NULL,
	"time_window" text NOT NULL,
	"outcome" text NOT NULL,
	"failure_reason" text,
	"format" text,
	"venue" text,
	"venue_address" text,
	"venue_url" text,
	"gathering_at" timestamp with time zone,
	"minimum" integer,
	"commit_deadline_at" timestamp with time zone,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suggestions_city_check" CHECK (char_length("suggestions"."city") BETWEEN 1 AND 60),
	CONSTRAINT "suggestions_area_check" CHECK (char_length("suggestions"."area") BETWEEN 1 AND 200),
	CONSTRAINT "suggestions_time_window_check" CHECK (char_length("suggestions"."time_window") BETWEEN 1 AND 200),
	CONSTRAINT "suggestions_outcome_check" CHECK ("suggestions"."outcome" IN ('ok', 'failed')),
	CONSTRAINT "suggestions_failure_reason_present_check" CHECK (("suggestions"."outcome" = 'failed') = ("suggestions"."failure_reason" IS NOT NULL)),
	CONSTRAINT "suggestions_failure_reason_check" CHECK ("suggestions"."failure_reason" IN ('timeout', 'api_error', 'no_proposal', 'pause_turn', 'refusal', 'max_tokens', 'invalid_proposal')),
	CONSTRAINT "suggestions_ok_fields_check" CHECK ("suggestions"."outcome" = 'failed' OR ("suggestions"."format" IS NOT NULL AND "suggestions"."venue" IS NOT NULL AND "suggestions"."gathering_at" IS NOT NULL AND "suggestions"."minimum" IS NOT NULL AND "suggestions"."commit_deadline_at" IS NOT NULL)),
	CONSTRAINT "suggestions_format_check" CHECK (char_length("suggestions"."format") BETWEEN 1 AND 40),
	CONSTRAINT "suggestions_venue_check" CHECK (char_length("suggestions"."venue") BETWEEN 1 AND 120),
	CONSTRAINT "suggestions_venue_address_check" CHECK (char_length("suggestions"."venue_address") BETWEEN 1 AND 200),
	CONSTRAINT "suggestions_venue_url_check" CHECK (char_length("suggestions"."venue_url") BETWEEN 1 AND 2048),
	CONSTRAINT "suggestions_minimum_check" CHECK ("suggestions"."minimum" >= 2),
	CONSTRAINT "suggestions_latency_ms_check" CHECK ("suggestions"."latency_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "check_in_answers" ADD CONSTRAINT "check_in_answers_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_commit_id_commits_id_fk" FOREIGN KEY ("commit_id") REFERENCES "public"."commits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_commit_id_commits_id_fk" FOREIGN KEY ("commit_id") REFERENCES "public"."commits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_suggestion_id_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."suggestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_from_plan_id_plans_id_fk" FOREIGN KEY ("from_plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_previous_suggestion_id_suggestions_id_fk" FOREIGN KEY ("previous_suggestion_id") REFERENCES "public"."suggestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commits_one_creator_per_plan" ON "commits" USING btree ("plan_id") WHERE "commits"."is_creator";--> statement-breakpoint
CREATE INDEX "idx_events_plan_id_created_at" ON "events" USING btree ("plan_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_events_commit_id" ON "events" USING btree ("commit_id");--> statement-breakpoint
CREATE INDEX "idx_plans_suggestion_id" ON "plans" USING btree ("suggestion_id");--> statement-breakpoint
CREATE INDEX "idx_plans_from_plan_id" ON "plans" USING btree ("from_plan_id");--> statement-breakpoint
CREATE INDEX "idx_suggestions_previous_suggestion_id" ON "suggestions" USING btree ("previous_suggestion_id");