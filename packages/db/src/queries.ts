import type { SummaryResult } from "@crafter/core/types";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Database } from "./client.ts";
import {
	channels,
	type DailySummary,
	dailySummaries,
	messages,
	type NewMessage,
	type Settings,
	settings,
	summaryRuns,
	type WhatsappSession,
	whatsappSession,
} from "./schema.ts";

/** YYYY-MM-DD for "now" in the given IANA zone. en-CA formats as ISO by default. */
export function localToday(timezone: string, at: Date = new Date()): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(at);
}

export function shiftDay(day: string, deltaDays: number): string {
	const d = new Date(`${day}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + deltaDays);
	return d.toISOString().slice(0, 10);
}

/**
 * Half-open [start, end) bounds for a local calendar day, as SQL expressions.
 *
 * We derive the day rather than storing it: the workspace timezone is a setting,
 * and a stored/generated day column would silently become wrong the moment it
 * changes. Expressing the filter as a range keeps the (channel_id, timestamp)
 * index usable, which a `(timestamp AT TIME ZONE tz)::date = day` predicate would not.
 */
function dayBounds(day: string, timezone: string) {
	const start = sql`(${day}::date)::timestamp AT TIME ZONE ${timezone}`;
	const end = sql`((${day}::date) + interval '1 day')::timestamp AT TIME ZONE ${timezone}`;
	return { start, end };
}

export async function getSettings(db: Database): Promise<Settings> {
	const [row] = await db.select().from(settings).where(eq(settings.id, "singleton")).limit(1);
	if (row) return row;

	const [created] = await db
		.insert(settings)
		.values({ id: "singleton" })
		.onConflictDoNothing()
		.returning();
	if (created) return created;

	// Lost the insert race against another process; the row exists now.
	const [existing] = await db.select().from(settings).where(eq(settings.id, "singleton")).limit(1);
	if (!existing) throw new Error("Failed to initialize settings row.");
	return existing;
}

export async function updateSettings(db: Database, patch: Partial<Settings>): Promise<Settings> {
	await getSettings(db);
	const [row] = await db
		.update(settings)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(settings.id, "singleton"))
		.returning();
	if (!row) throw new Error("Failed to update settings.");
	return row;
}

export async function getSession(db: Database): Promise<WhatsappSession> {
	const [row] = await db
		.select()
		.from(whatsappSession)
		.where(eq(whatsappSession.id, "singleton"))
		.limit(1);
	if (row) return row;

	const [created] = await db
		.insert(whatsappSession)
		.values({ id: "singleton" })
		.onConflictDoNothing()
		.returning();
	if (created) return created;

	const [existing] = await db
		.select()
		.from(whatsappSession)
		.where(eq(whatsappSession.id, "singleton"))
		.limit(1);
	if (!existing) throw new Error("Failed to initialize whatsapp_session row.");
	return existing;
}

export async function updateSession(
	db: Database,
	patch: Partial<WhatsappSession>,
): Promise<WhatsappSession> {
	await getSession(db);
	const [row] = await db
		.update(whatsappSession)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(whatsappSession.id, "singleton"))
		.returning();
	if (!row) throw new Error("Failed to update whatsapp_session.");
	return row;
}

/**
 * The ingestor is alive if it wrote a heartbeat recently. A `connected` status with
 * a stale heartbeat means the worker died without getting to mark itself down —
 * which is exactly the case where the mirror looks fine and isn't.
 */
export function isSessionLive(session: WhatsappSession, staleAfterMs = 3 * 60_000): boolean {
	if (session.status !== "connected") return false;
	if (!session.heartbeatAt) return false;
	return Date.now() - session.heartbeatAt.getTime() < staleAfterMs;
}

export async function listChannels(db: Database, opts: { trackedOnly?: boolean } = {}) {
	const rows = await db
		.select()
		.from(channels)
		.where(opts.trackedOnly ? eq(channels.tracked, true) : undefined)
		.orderBy(desc(channels.lastMessageAt), asc(channels.name));
	return rows;
}

export async function getChannel(db: Database, id: string) {
	const [row] = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
	return row ?? null;
}

/**
 * Upsert the catalog from WhatsApp. Deliberately does not touch `tracked` — the
 * catalog refresh must never silently enable ingestion for a group.
 */
export async function upsertChannels(
	db: Database,
	rows: { id: string; name: string; participantCount: number }[],
): Promise<void> {
	if (rows.length === 0) return;

	await db
		.insert(channels)
		.values(rows.map((r) => ({ ...r, kind: "group" })))
		.onConflictDoUpdate({
			target: channels.id,
			set: {
				name: sql`excluded.name`,
				participantCount: sql`excluded.participant_count`,
				updatedAt: new Date(),
			},
		});
}

/**
 * Insert messages, ignoring ones we already have. WhatsApp's message id is the
 * primary key, which makes reconnect backfill idempotent: replaying an overlapping
 * window costs nothing and heals any gap.
 */
export async function insertMessages(db: Database, rows: NewMessage[]): Promise<number> {
	if (rows.length === 0) return 0;

	const inserted = await db
		.insert(messages)
		.values(rows)
		.onConflictDoNothing({ target: messages.id })
		.returning({
			id: messages.id,
		});

	const latest = rows.reduce<Date | null>((acc, r) => {
		const ts =
			r.timestamp instanceof Date ? r.timestamp : new Date(r.timestamp as unknown as string);
		return !acc || ts > acc ? ts : acc;
	}, null);

	const channelId = rows[0]?.channelId;
	if (channelId && latest) {
		// Typed operators rather than a raw `sql` fragment: a bare Date interpolated
		// into a template is handed to the driver unmapped and serializes as a locale
		// string, which Postgres rejects.
		await db
			.update(channels)
			.set({ lastMessageAt: latest, updatedAt: new Date() })
			.where(
				and(
					eq(channels.id, channelId),
					or(isNull(channels.lastMessageAt), lt(channels.lastMessageAt, latest)),
				),
			);
	}

	return inserted.length;
}

export async function getMessagesForDay(
	db: Database,
	channelId: string,
	day: string,
	timezone: string,
) {
	const { start, end } = dayBounds(day, timezone);
	return db
		.select()
		.from(messages)
		.where(
			and(
				eq(messages.channelId, channelId),
				gte(messages.timestamp, start),
				lt(messages.timestamp, end),
			),
		)
		.orderBy(asc(messages.timestamp));
}

export async function countMessagesForDay(
	db: Database,
	channelId: string,
	day: string,
	timezone: string,
): Promise<number> {
	const { start, end } = dayBounds(day, timezone);
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(messages)
		.where(
			and(
				eq(messages.channelId, channelId),
				gte(messages.timestamp, start),
				lt(messages.timestamp, end),
			),
		);
	return row?.count ?? 0;
}

/** Days (local) that have at least one message, newest first. Drives the timeline. */
export async function listActiveDays(
	db: Database,
	channelId: string,
	timezone: string,
	limit = 60,
): Promise<{ day: string; messageCount: number }[]> {
	// Grouped by ordinal, not by repeating the expression. Each interpolation of
	// `timezone` emits its own bind parameter, and Postgres matches GROUP BY
	// expressions syntactically — so `AT TIME ZONE $1` and `AT TIME ZONE $3` are
	// different expressions to it, and the grouping never matches the projection:
	//   column "messages.timestamp" must appear in the GROUP BY clause
	const rows = await db
		.select({
			day: sql<string>`to_char((${messages.timestamp} AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD')`,
			messageCount: sql<number>`count(*)::int`,
		})
		.from(messages)
		.where(eq(messages.channelId, channelId))
		.groupBy(sql`1`)
		.orderBy(sql`1 desc`)
		.limit(limit);
	return rows;
}

export async function getDailySummary(
	db: Database,
	channelId: string,
	day: string,
): Promise<DailySummary | null> {
	const [row] = await db
		.select()
		.from(dailySummaries)
		.where(and(eq(dailySummaries.channelId, channelId), eq(dailySummaries.day, day)))
		.limit(1);
	return row ?? null;
}

export async function getSummariesInRange(
	db: Database,
	opts: { channelIds?: string[]; from: string; to: string },
): Promise<DailySummary[]> {
	const filters = [gte(dailySummaries.day, opts.from), lte(dailySummaries.day, opts.to)];
	if (opts.channelIds && opts.channelIds.length > 0) {
		filters.push(inArray(dailySummaries.channelId, opts.channelIds));
	}
	return db
		.select()
		.from(dailySummaries)
		.where(and(...filters))
		.orderBy(desc(dailySummaries.day));
}

export async function upsertSummary(
	db: Database,
	args: {
		channelId: string;
		day: string;
		timezone: string;
		frozen: boolean;
		result: SummaryResult;
	},
): Promise<DailySummary> {
	const values = {
		channelId: args.channelId,
		day: args.day,
		timezone: args.timezone,
		status: "ready" as const,
		frozen: args.frozen,
		tldr: args.result.tldr,
		decisions: args.result.decisions,
		actionItems: args.result.actionItems,
		openQuestions: args.result.openQuestions,
		links: args.result.links,
		participants: args.result.participants,
		markdown: args.result.markdown,
		messageCount: args.result.messageCount,
		model: args.result.model,
		generatedAt: new Date(),
		updatedAt: new Date(),
	};

	const [row] = await db
		.insert(dailySummaries)
		.values(values)
		.onConflictDoUpdate({
			target: [dailySummaries.channelId, dailySummaries.day],
			set: values,
			// A frozen past day is immutable: once written it is never recomputed.
			setWhere: sql`${dailySummaries.frozen} = false`,
		})
		.returning();

	if (row) return row;

	const existing = await getDailySummary(db, args.channelId, args.day);
	if (!existing) throw new Error("Failed to upsert summary.");
	return existing;
}

export async function recordSummaryRun(
	db: Database,
	args: {
		channelId: string;
		day: string;
		status: "ok" | "error";
		trigger: string;
		model?: string;
		promptTokens?: number;
		completionTokens?: number;
		durationMs?: number;
		error?: string;
	},
): Promise<void> {
	await db.insert(summaryRuns).values({
		channelId: args.channelId,
		day: args.day,
		status: args.status,
		trigger: args.trigger,
		model: args.model ?? null,
		promptTokens: args.promptTokens ?? 0,
		completionTokens: args.completionTokens ?? 0,
		durationMs: args.durationMs ?? 0,
		error: args.error ?? null,
	});
}

export type SearchHit = {
	id: string;
	channelId: string;
	channelName: string;
	authorName: string | null;
	timestamp: Date;
	excerpt: string;
};

const EXCERPT_CHARS = 200;
const SEARCH_MAX_LIMIT = 50;

/**
 * Full-text search over tracked channels only, returning capped excerpts rather
 * than whole messages — agents get enough to cite, not a transcript dump.
 */
export async function searchMessages(
	db: Database,
	opts: { query: string; channelId?: string; since?: string; limit?: number },
): Promise<SearchHit[]> {
	const limit = Math.min(Math.max(opts.limit ?? 20, 1), SEARCH_MAX_LIMIT);

	const filters = [
		eq(channels.tracked, true),
		sql`to_tsvector('simple', ${messages.body}) @@ plainto_tsquery('simple', ${opts.query})`,
	];
	if (opts.channelId) filters.push(eq(messages.channelId, opts.channelId));
	if (opts.since) filters.push(gte(messages.timestamp, sql`${opts.since}::date`));

	return db
		.select({
			id: messages.id,
			channelId: messages.channelId,
			channelName: channels.name,
			authorName: messages.authorName,
			timestamp: messages.timestamp,
			excerpt: sql<string>`left(${messages.body}, ${EXCERPT_CHARS})`,
		})
		.from(messages)
		.innerJoin(channels, eq(channels.id, messages.channelId))
		.where(and(...filters))
		.orderBy(desc(messages.timestamp))
		.limit(limit);
}
