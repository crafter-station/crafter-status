import OpenAI from "openai";
import { buildSummarySystemPrompt, formatTranscript, mediaPlaceholder } from "./prompts.ts";
import type { ChannelRef, SummaryContent, SummaryMessage, SummaryResult } from "./types.ts";

/**
 * Strict JSON schema for the structured half of a summary. `strict: true` requires
 * every property to be listed in `required`, so nullability is expressed in the
 * type union rather than by omission.
 */
const SUMMARY_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["tldr", "decisions", "actionItems", "openQuestions", "links", "participants"],
	properties: {
		tldr: { type: "string" },
		decisions: { type: "array", items: { type: "string" } },
		actionItems: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["text", "owner", "due"],
				properties: {
					text: { type: "string" },
					owner: { type: ["string", "null"] },
					due: { type: ["string", "null"] },
				},
			},
		},
		openQuestions: { type: "array", items: { type: "string" } },
		links: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["url", "label"],
				properties: { url: { type: "string" }, label: { type: "string" } },
			},
		},
		participants: { type: "array", items: { type: "string" } },
	},
} as const;

export type SummarizeOptions = {
	channel: ChannelRef;
	day: string;
	timezone: string;
	messages: SummaryMessage[];
	model: string;
	apiKey: string;
};

export async function summarizeDay(opts: SummarizeOptions): Promise<SummaryResult> {
	const { channel, day, timezone, messages, model, apiKey } = opts;

	if (messages.length === 0) {
		return {
			...emptyContent(`No messages in ${channel.name} on ${day}.`),
			markdown: renderMarkdown(
				channel,
				day,
				emptyContent(`No messages in ${channel.name} on ${day}.`),
			),
			model,
			messageCount: 0,
			promptTokens: 0,
			completionTokens: 0,
		};
	}

	const openai = new OpenAI({ apiKey });
	const transcript = formatTranscript(messages, timezone);

	const response = await openai.chat.completions.create({
		model,
		messages: [
			{ role: "system", content: buildSummarySystemPrompt(channel, day, timezone) },
			{ role: "user", content: transcript },
		],
		response_format: {
			type: "json_schema",
			json_schema: { name: "daily_summary", strict: true, schema: SUMMARY_SCHEMA },
		},
	});

	const raw = response.choices[0]?.message.content;
	if (!raw) throw new Error("OpenAI returned an empty summary.");

	const content = JSON.parse(raw) as SummaryContent;

	return {
		...content,
		markdown: renderMarkdown(channel, day, content),
		model,
		messageCount: messages.length,
		promptTokens: response.usage?.prompt_tokens ?? 0,
		completionTokens: response.usage?.completion_tokens ?? 0,
	};
}

function emptyContent(tldr: string): SummaryContent {
	return { tldr, decisions: [], actionItems: [], openQuestions: [], links: [], participants: [] };
}

/**
 * Markdown is rendered from the structure rather than asked for as a second model
 * output — otherwise the prose and the fields drift apart, and only one of them
 * would be right.
 */
export function renderMarkdown(channel: ChannelRef, day: string, c: SummaryContent): string {
	const parts: string[] = [`## ${channel.name} — ${day}`, "", c.tldr];

	if (c.decisions.length > 0) {
		parts.push("", "### Decisions", ...c.decisions.map((d) => `- ${d}`));
	}
	if (c.actionItems.length > 0) {
		parts.push(
			"",
			"### Action items",
			...c.actionItems.map((a) => {
				const owner = a.owner ? `**${a.owner}** — ` : "";
				const due = a.due ? ` _(${a.due})_` : "";
				return `- ${owner}${a.text}${due}`;
			}),
		);
	}
	if (c.openQuestions.length > 0) {
		parts.push("", "### Open questions", ...c.openQuestions.map((q) => `- ${q}`));
	}
	if (c.links.length > 0) {
		parts.push("", "### Links", ...c.links.map((l) => `- [${l.label}](${l.url})`));
	}
	if (c.participants.length > 0) {
		parts.push("", `_${c.participants.join(", ")}_`);
	}

	return parts.join("\n");
}

export { mediaPlaceholder };
