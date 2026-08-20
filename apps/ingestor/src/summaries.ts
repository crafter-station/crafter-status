import { summarizeDay } from "@crafter/core";
import type { DailySummary, Database } from "@crafter/db";
import {
	getChannel,
	getDailySummary,
	getMessagesForDay,
	getSettings,
	recordSummaryRun,
	upsertSummary,
} from "@crafter/db";
import { env } from "./env.ts";
import { log } from "./log.ts";

export type GenerateArgs = {
	channelId: string;
	day: string;
	/** Past days are written once and never recomputed. */
	freeze: boolean;
	trigger: "scheduler" | "manual" | "freeze";
};

export async function generateSummary(db: Database, args: GenerateArgs): Promise<DailySummary> {
	const settings = await getSettings(db);
	const channel = await getChannel(db, args.channelId);
	if (!channel) throw new Error(`Unknown channel: ${args.channelId}`);

	const existing = await getDailySummary(db, args.channelId, args.day);
	if (existing?.frozen) return existing;

	const rows = await getMessagesForDay(db, args.channelId, args.day, settings.timezone);
	const started = Date.now();

	try {
		const result = await summarizeDay({
			channel: { id: channel.id, name: channel.name },
			day: args.day,
			timezone: settings.timezone,
			messages: rows.map((m) => ({
				id: m.id,
				timestamp: m.timestamp,
				authorName: m.authorName,
				body: m.body,
				type: m.type,
				hasMedia: m.hasMedia,
			})),
			model: settings.summaryModel,
			apiKey: env.openaiApiKey,
		});

		const summary = await upsertSummary(db, {
			channelId: args.channelId,
			day: args.day,
			timezone: settings.timezone,
			frozen: args.freeze,
			result,
		});

		await recordSummaryRun(db, {
			channelId: args.channelId,
			day: args.day,
			status: "ok",
			trigger: args.trigger,
			model: result.model,
			promptTokens: result.promptTokens,
			completionTokens: result.completionTokens,
			durationMs: Date.now() - started,
		});

		log.info(
			`summary ${channel.name} ${args.day} (${result.messageCount} msgs, ${args.trigger}${args.freeze ? ", frozen" : ""})`,
		);
		return summary;
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		await recordSummaryRun(db, {
			channelId: args.channelId,
			day: args.day,
			status: "error",
			trigger: args.trigger,
			durationMs: Date.now() - started,
			error: message,
		});
		log.error(`summary failed ${channel.name} ${args.day}: ${message}`);
		throw e;
	}
}
