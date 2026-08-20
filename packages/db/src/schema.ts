import type { ActionItem, SummaryLink } from "@crafter/core/types";
import { sql } from "drizzle-orm";
import {
	boolean,
	date,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

export const sessionStatusEnum = pgEnum("session_status", [
	"disconnected",
	"qr_pending",
	"connecting",
	"connected",
]);

export const summaryStatusEnum = pgEnum("summary_status", ["pending", "ready", "error"]);
export const runStatusEnum = pgEnum("run_status", ["ok", "error"]);
export const userRoleEnum = pgEnum("user_role", ["admin", "member"]);

/** Single-row table. `id` is pinned to 'singleton' so a second row is impossible. */
export const settings = pgTable("settings", {
	id: text("id").primaryKey().default("singleton"),
	timezone: text("timezone").notNull().default("America/Lima"),
	backfillMessageLimit: integer("backfill_message_limit").notNull().default(1000),
	backfillDays: integer("backfill_days").notNull().default(30),
	summaryModel: text("summary_model").notNull().default("gpt-4o-mini"),
	askModel: text("ask_model").notNull().default("gpt-4o"),
	/** How stale today's summary may get before the scheduler rebuilds it. */
	todayRefreshMinutes: integer("today_refresh_minutes").notNull().default(30),
	/** Local wall-clock time at which yesterday's summary is frozen. */
	freezeHourLocal: integer("freeze_hour_local").notNull().default(0),
	freezeMinuteLocal: integer("freeze_minute_local").notNull().default(15),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Also single-row: there is exactly one shared org WhatsApp session. */
export const whatsappSession = pgTable("whatsapp_session", {
	id: text("id").primaryKey().default("singleton"),
	status: sessionStatusEnum("status").notNull().default("disconnected"),
	/** Raw QR payload, written by the ingestor and rendered in the dashboard. Cleared on pair. */
	qr: text("qr"),
	qrGeneratedAt: timestamp("qr_generated_at", { withTimezone: true }),
	phoneNumber: text("phone_number"),
	pushName: text("push_name"),
	lastReadyAt: timestamp("last_ready_at", { withTimezone: true }),
	lastDisconnectedAt: timestamp("last_disconnected_at", { withTimezone: true }),
	lastError: text("last_error"),
	/** Heartbeat from the ingestor; a stale value means the worker itself is down. */
	heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const channels = pgTable(
	"channels",
	{
		/** WhatsApp JID, e.g. 1234567890@g.us. */
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		/** Room for WhatsApp Channels (newsletters) later without a migration. */
		kind: text("kind").notNull().default("group"),
		participantCount: integer("participant_count").notNull().default(0),
		/** Untracked channels store name + id only. No message content is persisted. */
		tracked: boolean("tracked").notNull().default(false),
		trackedAt: timestamp("tracked_at", { withTimezone: true }),
		trackedByUserId: text("tracked_by_user_id"),
		lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
		backfilledAt: timestamp("backfilled_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("channels_tracked_idx").on(t.tracked),
		index("channels_last_message_idx").on(t.lastMessageAt),
	],
);

export const messages = pgTable(
	"messages",
	{
		/** WhatsApp's own serialized message id. This IS the dedupe key on reconnect. */
		id: text("id").primaryKey(),
		channelId: text("channel_id")
			.notNull()
			.references(() => channels.id, { onDelete: "cascade" }),
		authorJid: text("author_jid"),
		authorName: text("author_name"),
		body: text("body").notNull().default(""),
		type: text("type").notNull().default("chat"),
		hasMedia: boolean("has_media").notNull().default(false),
		timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
		fromMe: boolean("from_me").notNull().default(false),
		quotedMessageId: text("quoted_message_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("messages_channel_time_idx").on(t.channelId, t.timestamp.desc()),
		index("messages_time_idx").on(t.timestamp.desc()),
		// 'simple' rather than a language stemmer: these groups mix Spanish and English,
		// and a Spanish stemmer would quietly mangle the English half.
		index("messages_body_fts_idx").using("gin", sql`to_tsvector('simple', ${t.body})`),
	],
);

export const dailySummaries = pgTable(
	"daily_summaries",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		channelId: text("channel_id")
			.notNull()
			.references(() => channels.id, { onDelete: "cascade" }),
		/** The local calendar day, resolved with the workspace timezone at write time. */
		day: date("day").notNull(),
		timezone: text("timezone").notNull(),
		status: summaryStatusEnum("status").notNull().default("pending"),
		/** Past days are frozen and never recomputed; today's is rebuilt on a cadence. */
		frozen: boolean("frozen").notNull().default(false),
		tldr: text("tldr").notNull().default(""),
		decisions: jsonb("decisions").$type<string[]>().notNull().default([]),
		actionItems: jsonb("action_items").$type<ActionItem[]>().notNull().default([]),
		openQuestions: jsonb("open_questions").$type<string[]>().notNull().default([]),
		links: jsonb("links").$type<SummaryLink[]>().notNull().default([]),
		participants: jsonb("participants").$type<string[]>().notNull().default([]),
		markdown: text("markdown").notNull().default(""),
		messageCount: integer("message_count").notNull().default(0),
		model: text("model"),
		generatedAt: timestamp("generated_at", { withTimezone: true }),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("daily_summaries_channel_day_idx").on(t.channelId, t.day),
		index("daily_summaries_day_idx").on(t.day.desc()),
	],
);

/** Thin mirror of Clerk, kept in sync by the Clerk webhook. Clerk stays the source of truth. */
export const users = pgTable("users", {
	/** Clerk user id. */
	id: text("id").primaryKey(),
	githubLogin: text("github_login"),
	name: text("name"),
	email: text("email"),
	avatarUrl: text("avatar_url"),
	role: userRoleEnum("role").notNull().default("member"),
	/** Result of the last crafter-station membership check. */
	isOrgMember: boolean("is_org_member").notNull().default(false),
	orgCheckedAt: timestamp("org_checked_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Fallback credential for MCP clients whose OAuth support disappoints. */
export const apiTokens = pgTable(
	"api_tokens",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		/** First 12 chars, shown in the UI so a token is identifiable after creation. */
		prefix: text("prefix").notNull(),
		/** SHA-256 of the full token. The plaintext is shown once and never stored. */
		tokenHash: text("token_hash").notNull().unique(),
		lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("api_tokens_user_idx").on(t.userId)],
);

export const auditLog = pgTable(
	"audit_log",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		actorUserId: text("actor_user_id"),
		actorLabel: text("actor_label"),
		action: text("action").notNull(),
		targetType: text("target_type"),
		targetId: text("target_id"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("audit_log_created_idx").on(t.createdAt.desc())],
);

/** One row per summary generation attempt, so a failing nightly job is visible. */
export const summaryRuns = pgTable(
	"summary_runs",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		channelId: text("channel_id")
			.notNull()
			.references(() => channels.id, { onDelete: "cascade" }),
		day: date("day").notNull(),
		status: runStatusEnum("status").notNull(),
		trigger: text("trigger").notNull().default("scheduler"),
		model: text("model"),
		promptTokens: integer("prompt_tokens").notNull().default(0),
		completionTokens: integer("completion_tokens").notNull().default(0),
		durationMs: integer("duration_ms").notNull().default(0),
		error: text("error"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("summary_runs_channel_day_idx").on(t.channelId, t.day.desc())],
);

export type Channel = typeof channels.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type DailySummary = typeof dailySummaries.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type WhatsappSession = typeof whatsappSession.$inferSelect;
export type User = typeof users.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
