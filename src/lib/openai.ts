import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import wwebjs from "whatsapp-web.js";
import { loadConfig } from "../cli/config.ts";
import type { GroupSummary } from "../types.ts";
import { fetchGroupTranscript } from "./whatsapp.ts";

const { Client } = wwebjs;

const MAX_ITERATIONS = 8;
const TOOL_DEFAULT_LIMIT = 200;
const TOOL_MAX_LIMIT = 500;

export type ToolCallTrace = {
	name: string;
	args: Record<string, unknown>;
};

export type AskResult = {
	answer: string;
	model: string;
	iterations: number;
	toolCalls: ToolCallTrace[];
};

const TOOLS: ChatCompletionTool[] = [
	{
		type: "function",
		function: {
			name: "fetch_group_messages",
			description:
				"Fetch the most recent messages from a single WhatsApp group. Use this to inspect the contents of any group you think is relevant to the user's question. You can call this multiple times in parallel for different groups.",
			parameters: {
				type: "object",
				properties: {
					group_id: {
						type: "string",
						description: "The WhatsApp group ID (e.g. 1234567890@g.us) from the groups list provided in the system prompt.",
					},
					limit: {
						type: "number",
						description: `Max number of recent messages to fetch (default ${TOOL_DEFAULT_LIMIT}, hard cap ${TOOL_MAX_LIMIT}). Use smaller values for quick scans, larger for deep questions.`,
					},
				},
				required: ["group_id"],
			},
		},
	},
];

function buildSystemPrompt(groups: GroupSummary[]): string {
	const groupsCatalog = groups
		.map((g) => `- ${g.name} | id=${g.id} | members=${g.participantCount}`)
		.join("\n");

	return [
		"You are an assistant that answers questions about a user's WhatsApp groups.",
		"",
		"You have access to ONE tool: `fetch_group_messages(group_id, limit?)` — call it to read the recent messages of a group you think is relevant. You may call it for several groups in parallel in a single turn.",
		"",
		"Strategy:",
		"1. Read the user's question and the groups catalog below.",
		"2. Pick the group(s) most likely to contain the answer. Match by name, language, topic, or by an ID the user mentioned directly.",
		"3. If unsure between a few candidates, call `fetch_group_messages` on each in parallel (in one assistant turn) and let the messages decide.",
		"4. Do NOT fetch every group — that wastes tokens and time. Be selective.",
		"5. If after fetching you still need more, call the tool again on different groups.",
		"6. Once you have enough information, write the final answer. Cite group names. Quote short message excerpts when helpful.",
		"7. If the answer isn't present in any group you checked, say so plainly. Do not invent details.",
		"8. Respond in the same language as the user's question.",
		"",
		`Available groups (${groups.length}):`,
		groupsCatalog,
	].join("\n");
}

type ProgressFn = (event: { type: "tool_call"; name: string; args: Record<string, unknown> }) => void;

async function executeToolCall(
	client: InstanceType<typeof Client>,
	name: string,
	args: Record<string, unknown>,
): Promise<string> {
	if (name !== "fetch_group_messages") {
		return JSON.stringify({ error: `Unknown tool: ${name}` });
	}

	const groupId = args.group_id;
	if (typeof groupId !== "string" || !groupId) {
		return JSON.stringify({ error: "group_id is required and must be a string" });
	}

	const rawLimit = typeof args.limit === "number" ? args.limit : TOOL_DEFAULT_LIMIT;
	const limit = Math.max(1, Math.min(rawLimit, TOOL_MAX_LIMIT));

	try {
		const transcript = await fetchGroupTranscript(client, groupId, limit);
		// Messages come back newest-first; flip to chronological for the model.
		const ordered = [...transcript.messages].reverse();
		const formatted = ordered.map((m) => ({
			t: new Date(m.timestamp).toISOString(),
			from: m.author ?? m.from,
			body: m.body || `(${m.type})`,
		}));
		return JSON.stringify({
			group: transcript.group,
			count: formatted.length,
			messages: formatted,
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return JSON.stringify({ error: `fetch_group_messages failed for ${groupId}: ${msg}` });
	}
}

export async function askAgent(
	question: string,
	groups: GroupSummary[],
	client: InstanceType<typeof Client>,
	progress?: ProgressFn,
): Promise<AskResult> {
	const config = loadConfig();
	const openai = new OpenAI({ apiKey: config.openaiApiKey });

	const messages: ChatCompletionMessageParam[] = [
		{ role: "system", content: buildSystemPrompt(groups) },
		{ role: "user", content: question },
	];

	const toolCalls: ToolCallTrace[] = [];

	for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
		const response = await openai.chat.completions.create({
			model: config.model,
			messages,
			tools: TOOLS,
			tool_choice: "auto",
		});

		const choice = response.choices[0];
		if (!choice) {
			throw new Error("OpenAI returned no choices.");
		}
		const assistant = choice.message;
		messages.push(assistant);

		const calls = assistant.tool_calls ?? [];
		if (calls.length === 0) {
			return {
				answer: assistant.content?.trim() ?? "(no response from model)",
				model: config.model,
				iterations: iteration,
				toolCalls,
			};
		}

		const results = await Promise.all(
			calls.map(async (call) => {
				if (call.type !== "function") {
					return {
						tool_call_id: call.id,
						content: JSON.stringify({ error: `Unsupported tool type: ${call.type}` }),
					};
				}
				let parsed: Record<string, unknown> = {};
				try {
					parsed = JSON.parse(call.function.arguments) as Record<string, unknown>;
				} catch {
					return {
						tool_call_id: call.id,
						content: JSON.stringify({ error: "Invalid JSON arguments from model" }),
					};
				}

				toolCalls.push({ name: call.function.name, args: parsed });
				progress?.({ type: "tool_call", name: call.function.name, args: parsed });

				const content = await executeToolCall(client, call.function.name, parsed);
				return { tool_call_id: call.id, content };
			}),
		);

		for (const r of results) {
			messages.push({ role: "tool", tool_call_id: r.tool_call_id, content: r.content });
		}
	}

	throw new Error(
		`Agent exceeded ${MAX_ITERATIONS} iterations without a final answer. Try rephrasing the question or narrowing scope.`,
	);
}
