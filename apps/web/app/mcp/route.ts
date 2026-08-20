import { verifyClerkToken } from "@clerk/mcp-tools/next";
import { auth } from "@clerk/nextjs/server";
import { runAsk } from "@crafter/core";
import {
	getChannel,
	getDailySummary,
	getSession,
	getSettings,
	getSummariesInRange,
	isSessionLive,
	listChannels,
	localToday,
	searchMessages,
	verifyApiToken,
} from "@crafter/db";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { resolveAccessForUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type ToolExtra = { authInfo?: AuthInfo; http?: { authInfo?: AuthInfo } };

/**
 * The verified token rides on the tool callback's context object, which the SDK
 * does not export a type for. In this version it sits under `http.authInfo`; older
 * transports put it at the top level, so both are checked.
 */
function authOf(extra: unknown): AuthInfo | undefined {
	const context = extra as ToolExtra | undefined;
	return context?.http?.authInfo ?? context?.authInfo;
}

/**
 * Every tool runs this first. Authentication proves *who* is calling; this proves
 * they are still in the GitHub org, which is the actual gate.
 */
async function requirePrincipal(extra: unknown): Promise<string> {
	const userId = authOf(extra)?.extra?.userId;
	if (typeof userId !== "string") {
		throw new Error("Unauthenticated.");
	}
	const access = await resolveAccessForUser(userId);
	if (!access?.isOrgMember) {
		throw new Error("Your GitHub account is not an active member of the organization.");
	}
	return userId;
}

function text(payload: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

const handler = createMcpHandler(
	(server) => {
		server.registerTool(
			"list_channels",
			{
				title: "List channels",
				description:
					"List the WhatsApp groups being mirrored, with the freshness of the mirror. Call this first: `session_status.live` tells you whether the data is current. If it is false, say so instead of presenting stale summaries as current.",
				inputSchema: {},
			},
			async (_args, extra) => {
				await requirePrincipal(extra);
				const db = getDb();
				const [settings, session, channels] = await Promise.all([
					getSettings(db),
					getSession(db),
					listChannels(db, { trackedOnly: true }),
				]);

				return text({
					timezone: settings.timezone,
					today: localToday(settings.timezone),
					session_status: {
						live: isSessionLive(session),
						state: session.status,
						last_heartbeat: session.heartbeatAt?.toISOString() ?? null,
						note: isSessionLive(session)
							? "Mirror is live."
							: "The WhatsApp worker is not connected — recent messages may be missing.",
					},
					channels: channels.map((c) => ({
						id: c.id,
						name: c.name,
						members: c.participantCount,
						last_message_at: c.lastMessageAt?.toISOString() ?? null,
					})),
				});
			},
		);

		server.registerTool(
			"get_daily_summary",
			{
				title: "Get daily summary",
				description:
					"Get the stored summary for one channel on one local calendar day (YYYY-MM-DD). Past days are frozen; today's is rebuilt periodically.",
				inputSchema: {
					channel_id: z.string().describe("Channel id from list_channels"),
					date: z
						.string()
						.regex(/^\d{4}-\d{2}-\d{2}$/)
						.optional()
						.describe("Defaults to today"),
				},
			},
			async ({ channel_id, date }, extra) => {
				await requirePrincipal(extra);
				const db = getDb();
				const settings = await getSettings(db);
				const day = date ?? localToday(settings.timezone);

				const channel = await getChannel(db, channel_id);
				if (!channel?.tracked) {
					return text({ error: `Channel ${channel_id} is not tracked.` });
				}

				const summary = await getDailySummary(db, channel_id, day);
				if (!summary) {
					return text({
						channel: channel.name,
						day,
						summary: null,
						note: "No summary stored for this day.",
					});
				}

				return text({
					channel: channel.name,
					day,
					frozen: summary.frozen,
					message_count: summary.messageCount,
					generated_at: summary.generatedAt?.toISOString() ?? null,
					tldr: summary.tldr,
					decisions: summary.decisions,
					action_items: summary.actionItems,
					open_questions: summary.openQuestions,
					links: summary.links,
					participants: summary.participants,
				});
			},
		);

		server.registerTool(
			"get_summaries",
			{
				title: "Get summaries over a range",
				description:
					"Get summaries across a date range, optionally narrowed to one channel. Use for 'this week' or 'since Monday' questions.",
				inputSchema: {
					from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
					to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
					channel_id: z.string().optional().describe("Omit to span every tracked channel"),
				},
			},
			async ({ from, to, channel_id }, extra) => {
				await requirePrincipal(extra);
				const db = getDb();
				const channels = await listChannels(db, { trackedOnly: true });
				const names = new Map(channels.map((c) => [c.id, c.name]));

				const summaries = await getSummariesInRange(db, {
					channelIds: channel_id ? [channel_id] : channels.map((c) => c.id),
					from,
					to,
				});

				return text({
					from,
					to,
					count: summaries.length,
					summaries: summaries.map((s) => ({
						channel: names.get(s.channelId) ?? s.channelId,
						channel_id: s.channelId,
						day: s.day,
						tldr: s.tldr,
						decisions: s.decisions,
						action_items: s.actionItems,
						open_questions: s.openQuestions,
						message_count: s.messageCount,
					})),
				});
			},
		);

		server.registerTool(
			"search_messages",
			{
				title: "Search messages",
				description:
					"Keyword search over raw messages in tracked channels. Returns capped excerpts, not full transcripts. Use when a summary is too coarse or the user wants exact wording.",
				inputSchema: {
					query: z.string().min(1),
					channel_id: z.string().optional(),
					since: z
						.string()
						.regex(/^\d{4}-\d{2}-\d{2}$/)
						.optional(),
					limit: z.number().int().min(1).max(50).optional(),
				},
			},
			async ({ query, channel_id, since, limit }, extra) => {
				await requirePrincipal(extra);
				const hits = await searchMessages(getDb(), { query, channelId: channel_id, since, limit });

				return text({
					query,
					count: hits.length,
					hits: hits.map((h) => ({
						channel: h.channelName,
						channel_id: h.channelId,
						author: h.authorName,
						at: h.timestamp.toISOString(),
						excerpt: h.excerpt,
					})),
				});
			},
		);

		server.registerTool(
			"ask",
			{
				title: "Ask about the groups",
				description:
					"Ask a natural-language question about the mirrored groups. Runs a server-side agent that picks its own summaries and searches. Slower than the other tools — prefer them when you already know what you want.",
				inputSchema: {
					question: z.string().min(1),
					channel_id: z.string().optional().describe("Narrow the agent to one channel"),
				},
			},
			async ({ question, channel_id }, extra) => {
				await requirePrincipal(extra);
				const db = getDb();
				const settings = await getSettings(db);
				const all = await listChannels(db, { trackedOnly: true });
				const scope = channel_id ? all.filter((c) => c.id === channel_id) : all;

				if (scope.length === 0) {
					return text({ error: "No tracked channels to search." });
				}

				const apiKey = process.env.OPENAI_API_KEY;
				if (!apiKey) return text({ error: "OPENAI_API_KEY is not configured on the server." });

				const result = await runAsk({
					question,
					channels: scope.map((c) => ({ id: c.id, name: c.name })),
					timezone: settings.timezone,
					today: localToday(settings.timezone),
					model: settings.askModel,
					apiKey,
					tools: {
						getDailySummary: async (id, date) => getDailySummary(db, id, date),
						getSummaries: async (a) =>
							getSummariesInRange(db, {
								channelIds: a.channelId ? [a.channelId] : scope.map((c) => c.id),
								from: a.from,
								to: a.to,
							}),
						searchMessages: async (a) => searchMessages(db, a),
					},
				});

				return text({ answer: result.answer, tool_calls: result.toolCalls, model: result.model });
			},
		);
	},
	{
		serverInfo: { name: "crafter-status", version: "0.2.0" },
	},
);

/**
 * Two credentials are accepted, both resolving to the same Clerk user:
 *  - a Clerk-issued OAuth token (the primary path, via Dynamic Client Registration)
 *  - a `crft_…` personal token minted in the dashboard, for clients whose OAuth
 *    support is unreliable
 */
const authenticated = withMcpAuth(
	handler,
	async (_req, bearerToken) => {
		if (!bearerToken) return undefined;

		if (bearerToken.startsWith("crft_")) {
			const principal = await verifyApiToken(getDb(), bearerToken);
			if (!principal) return undefined;
			return {
				token: bearerToken,
				clientId: `personal-token:${principal.tokenId}`,
				scopes: ["crafter:read"],
				extra: { userId: principal.userId },
			};
		}

		const clerkAuth = await auth({ acceptsToken: "oauth_token" });
		return verifyClerkToken(clerkAuth, bearerToken);
	},
	{
		required: true,
		resourceMetadataPath: "/.well-known/oauth-protected-resource",
	},
);

export { authenticated as GET, authenticated as POST, authenticated as DELETE };
