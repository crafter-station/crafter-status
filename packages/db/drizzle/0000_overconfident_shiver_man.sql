CREATE TYPE "public"."run_status" AS ENUM('ok', 'error');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('disconnected', 'qr_pending', 'connecting', 'connected');--> statement-breakpoint
CREATE TYPE "public"."summary_status" AS ENUM('pending', 'ready', 'error');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"actor_label" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'group' NOT NULL,
	"participant_count" integer DEFAULT 0 NOT NULL,
	"tracked" boolean DEFAULT false NOT NULL,
	"tracked_at" timestamp with time zone,
	"tracked_by_user_id" text,
	"last_message_at" timestamp with time zone,
	"backfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" text NOT NULL,
	"day" date NOT NULL,
	"timezone" text NOT NULL,
	"status" "summary_status" DEFAULT 'pending' NOT NULL,
	"frozen" boolean DEFAULT false NOT NULL,
	"tldr" text DEFAULT '' NOT NULL,
	"decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"open_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"markdown" text DEFAULT '' NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"model" text,
	"generated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"author_jid" text,
	"author_name" text,
	"body" text DEFAULT '' NOT NULL,
	"type" text DEFAULT 'chat' NOT NULL,
	"has_media" boolean DEFAULT false NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"from_me" boolean DEFAULT false NOT NULL,
	"quoted_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"timezone" text DEFAULT 'America/Lima' NOT NULL,
	"backfill_message_limit" integer DEFAULT 1000 NOT NULL,
	"backfill_days" integer DEFAULT 30 NOT NULL,
	"summary_model" text DEFAULT 'gpt-4o-mini' NOT NULL,
	"ask_model" text DEFAULT 'gpt-4o' NOT NULL,
	"today_refresh_minutes" integer DEFAULT 30 NOT NULL,
	"freeze_hour_local" integer DEFAULT 0 NOT NULL,
	"freeze_minute_local" integer DEFAULT 15 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summary_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" text NOT NULL,
	"day" date NOT NULL,
	"status" "run_status" NOT NULL,
	"trigger" text DEFAULT 'scheduler' NOT NULL,
	"model" text,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"github_login" text,
	"name" text,
	"email" text,
	"avatar_url" text,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"is_org_member" boolean DEFAULT false NOT NULL,
	"org_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_session" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"status" "session_status" DEFAULT 'disconnected' NOT NULL,
	"qr" text,
	"qr_generated_at" timestamp with time zone,
	"phone_number" text,
	"push_name" text,
	"last_ready_at" timestamp with time zone,
	"last_disconnected_at" timestamp with time zone,
	"last_error" text,
	"heartbeat_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_summaries" ADD CONSTRAINT "daily_summaries_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD CONSTRAINT "summary_runs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "channels_tracked_idx" ON "channels" USING btree ("tracked");--> statement-breakpoint
CREATE INDEX "channels_last_message_idx" ON "channels" USING btree ("last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_summaries_channel_day_idx" ON "daily_summaries" USING btree ("channel_id","day");--> statement-breakpoint
CREATE INDEX "daily_summaries_day_idx" ON "daily_summaries" USING btree ("day" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_channel_time_idx" ON "messages" USING btree ("channel_id","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_time_idx" ON "messages" USING btree ("timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_body_fts_idx" ON "messages" USING gin (to_tsvector('simple', "body"));--> statement-breakpoint
CREATE INDEX "summary_runs_channel_day_idx" ON "summary_runs" USING btree ("channel_id","day" DESC NULLS LAST);