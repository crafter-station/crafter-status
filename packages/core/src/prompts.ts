import type { ChannelRef, SummaryMessage } from "./types.ts";

/** Transcript lines the model reads. Media is a placeholder, never invented content. */
export function formatTranscript(messages: SummaryMessage[], timezone: string): string {
	const time = new Intl.DateTimeFormat("en-GB", {
		timeZone: timezone,
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});

	return messages
		.map((m) => {
			const who = m.authorName ?? "unknown";
			const body = m.body.trim() || mediaPlaceholder(m.type);
			return `[${time.format(m.timestamp)}] ${who}: ${body}`;
		})
		.join("\n");
}

export function mediaPlaceholder(type: string): string {
	switch (type) {
		case "image":
			return "(image)";
		case "video":
			return "(video)";
		case "ptt":
		case "audio":
			return "(voice note)";
		case "document":
			return "(document)";
		case "sticker":
			return "(sticker)";
		case "location":
			return "(location)";
		default:
			return `(${type})`;
	}
}

export function buildSummarySystemPrompt(
	channel: ChannelRef,
	day: string,
	timezone: string,
): string {
	return [
		"You summarize one day of messages from a single WhatsApp group for a team status board.",
		"",
		`Group: ${channel.name}`,
		`Day: ${day} (timezone ${timezone})`,
		"",
		"Rules:",
		"1. Write EVERY field in the dominant language of the transcript — the tldr included, not only the lists. If the group mixes Spanish and English, use whichever dominates that day. Do not translate into English.",
		"2. Report only what the transcript says. Never infer decisions, owners, or dates that were not stated.",
		"3. `decisions` are things the group actually settled, not things merely discussed.",
		"4. `actionItems` need an owner only when a person was clearly named; otherwise owner is null. Same for `due`.",
		"5. `openQuestions` are questions raised that nobody answered in this day's transcript.",
		"6. `participants` are the display names that actually sent a message.",
		"7. Lines like (image) or (voice note) are media we did not download. Mention that media was shared if it matters, but never guess its contents.",
		"8. A quiet day is a valid answer. If nothing meaningful happened, say so in `tldr` and leave the arrays empty.",
		"9. `tldr` is 2-3 sentences, no preamble, no 'In this group...' framing.",
	].join("\n");
}

export function buildAskSystemPrompt(
	channels: ChannelRef[],
	timezone: string,
	today: string,
): string {
	const catalog = channels.map((c) => `- ${c.name} | id=${c.id}`).join("\n");

	return [
		"You answer questions about a team's WhatsApp groups, using tools that read a Postgres mirror of those groups.",
		"",
		`Today is ${today} in timezone ${timezone}.`,
		"",
		"Tools:",
		"- `get_daily_summary(channel_id, date)` — a pre-written summary for one group on one day. Cheapest, prefer it.",
		"- `get_summaries(channel_id?, from, to)` — summaries across a date range.",
		"- `search_messages(query, channel_id?, since?)` — keyword search over raw message excerpts. Use when summaries are too coarse or the user asks for exact wording.",
		"",
		"Strategy:",
		"1. Pick the group(s) that plausibly hold the answer. Do not sweep every group.",
		"2. Reach for summaries first; drop to search only when you need specifics a summary would have dropped.",
		"3. Cite group names and dates in the answer.",
		"4. If the mirror has no data covering the question, say so plainly rather than guessing.",
		"5. Answer in the language of the question.",
		"",
		`Groups (${channels.length}):`,
		catalog,
	].join("\n");
}
