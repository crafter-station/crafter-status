import OpenAI from "openai";
import type {
	ChatCompletionMessageParam,
	ChatCompletionTool,
} from "openai/resources/chat/completions";
import { buildAskSystemPrompt } from "./prompts.ts";
import type { ChannelRef } from "./types.ts";

const MAX_ITERATIONS = 8;

/**
 * The data access the agent needs, injected by the caller. Core stays free of any
 * database dependency; the web app wires these to Drizzle queries and the CLI wires
 * them to HTTP calls against the same endpoints.
 */
export type AskTools = {
	getDailySummary(channelId: string, date: string): Promise<unknown>;
	getSummaries(args: { channelId?: string; from: string; to: string }): Promise<unknown>;
	searchMessages(args: {
		query: string;
		channelId?: string;
		since?: string;
		limit?: number;
	}): Promise<unknown>;
};

export type AskResult = {
	answer: string;
	model: string;
	iterations: number;
	toolCalls: { name: string; args: Record<string, unknown> }[];
};

const TOOLS: ChatCompletionTool[] = [
	{
		type: "function",
		function: {
			name: "get_daily_summary",
			description:
				"Get the stored summary for one group on one day (YYYY-MM-DD). Cheapest source; prefer it.",
			parameters: {
				type: "object",
				properties: {
					channel_id: { type: "string" },
					date: { type: "string", description: "YYYY-MM-DD in the workspace timezone" },
				},
				required: ["channel_id", "date"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "get_summaries",
			description:
				"Get summaries across a date range, optionally for one group. Use for 'this week' style questions.",
			parameters: {
				type: "object",
				properties: {
					channel_id: { type: "string", description: "Omit to span every tracked group." },
					from: { type: "string", description: "YYYY-MM-DD inclusive" },
					to: { type: "string", description: "YYYY-MM-DD inclusive" },
				},
				required: ["from", "to"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "search_messages",
			description:
				"Keyword search over raw message excerpts. Use when a summary is too coarse or the user wants exact wording. Returns capped excerpts, not full transcripts.",
			parameters: {
				type: "object",
				properties: {
					query: { type: "string" },
					channel_id: { type: "string" },
					since: { type: "string", description: "YYYY-MM-DD lower bound" },
					limit: { type: "number" },
				},
				required: ["query"],
			},
		},
	},
];

export type AskOptions = {
	question: string;
	channels: ChannelRef[];
	timezone: string;
	today: string;
	model: string;
	apiKey: string;
	tools: AskTools;
	onToolCall?: (name: string, args: Record<string, unknown>) => void;
};

export async function runAsk(opts: AskOptions): Promise<AskResult> {
	const openai = new OpenAI({ apiKey: opts.apiKey });

	const messages: ChatCompletionMessageParam[] = [
		{ role: "system", content: buildAskSystemPrompt(opts.channels, opts.timezone, opts.today) },
		{ role: "user", content: opts.question },
	];

	const toolCalls: AskResult["toolCalls"] = [];

	for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
		const response = await openai.chat.completions.create({
			model: opts.model,
			messages,
			tools: TOOLS,
			tool_choice: "auto",
		});

		const assistant = response.choices[0]?.message;
		if (!assistant) throw new Error("OpenAI returned no choices.");
		messages.push(assistant);

		const calls = assistant.tool_calls ?? [];
		if (calls.length === 0) {
			return {
				answer: assistant.content?.trim() ?? "(no response from model)",
				model: opts.model,
				iterations: iteration,
				toolCalls,
			};
		}

		const results = await Promise.all(
			calls.map(async (call) => {
				if (call.type !== "function") {
					return {
						tool_call_id: call.id,
						content: JSON.stringify({ error: "Unsupported tool type" }),
					};
				}
				let args: Record<string, unknown> = {};
				try {
					args = JSON.parse(call.function.arguments) as Record<string, unknown>;
				} catch {
					return {
						tool_call_id: call.id,
						content: JSON.stringify({ error: "Invalid JSON arguments" }),
					};
				}

				toolCalls.push({ name: call.function.name, args });
				opts.onToolCall?.(call.function.name, args);

				const content = await execute(opts.tools, call.function.name, args);
				return { tool_call_id: call.id, content };
			}),
		);

		for (const r of results) {
			messages.push({ role: "tool", tool_call_id: r.tool_call_id, content: r.content });
		}
	}

	throw new Error(
		`Agent exceeded ${MAX_ITERATIONS} iterations without answering. Narrow the question.`,
	);
}

async function execute(
	tools: AskTools,
	name: string,
	args: Record<string, unknown>,
): Promise<string> {
	try {
		switch (name) {
			case "get_daily_summary": {
				const channelId = requireString(args.channel_id, "channel_id");
				const date = requireString(args.date, "date");
				return JSON.stringify(await tools.getDailySummary(channelId, date));
			}
			case "get_summaries": {
				return JSON.stringify(
					await tools.getSummaries({
						channelId: typeof args.channel_id === "string" ? args.channel_id : undefined,
						from: requireString(args.from, "from"),
						to: requireString(args.to, "to"),
					}),
				);
			}
			case "search_messages": {
				return JSON.stringify(
					await tools.searchMessages({
						query: requireString(args.query, "query"),
						channelId: typeof args.channel_id === "string" ? args.channel_id : undefined,
						since: typeof args.since === "string" ? args.since : undefined,
						limit: typeof args.limit === "number" ? args.limit : undefined,
					}),
				);
			}
			default:
				return JSON.stringify({ error: `Unknown tool: ${name}` });
		}
	} catch (e) {
		return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
	}
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${field} is required and must be a non-empty string`);
	}
	return value;
}
