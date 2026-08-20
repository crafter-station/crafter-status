import type { Database } from "@crafter/db";
import {
	getDailySummary,
	getSettings,
	listActiveDays,
	listChannels,
	localToday,
} from "@crafter/db";
import { log } from "./log.ts";
import { generateSummary } from "./summaries.ts";
import type { WhatsAppRunner } from "./whatsapp.ts";

const TICK_MS = 60_000;
/** Cap per tick so a cold start with weeks of backlog doesn't fire hundreds of calls at once. */
const MAX_FREEZE_JOBS_PER_TICK = 5;

/** Local wall-clock minutes since midnight in the workspace timezone. */
function localMinutes(timezone: string, at: Date = new Date()): number {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: timezone,
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).formatToParts(at);
	const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
	const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
	return hour * 60 + minute;
}

export class Scheduler {
	private timer: ReturnType<typeof setInterval> | null = null;
	private running = false;

	constructor(
		private readonly db: Database,
		private readonly whatsapp: WhatsAppRunner,
	) {}

	start(): void {
		if (this.timer) return;
		void this.tick();
		this.timer = setInterval(() => void this.tick(), TICK_MS);
		log.info("scheduler started");
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	/** Ticks never overlap: a slow OpenAI call must not stack up behind itself. */
	private async tick(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			await this.whatsapp.heartbeat();
			await this.refreshToday();
			await this.freezePastDays();
		} catch (e) {
			log.error(`scheduler tick failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			this.running = false;
		}
	}

	/**
	 * Today's summary is never frozen. It is rebuilt when the channel has received
	 * messages since the last generation and the refresh interval has elapsed — so a
	 * page load is at worst `todayRefreshMinutes` behind, and a quiet channel costs
	 * nothing.
	 */
	private async refreshToday(): Promise<void> {
		const settings = await getSettings(this.db);
		const today = localToday(settings.timezone);
		const channels = await listChannels(this.db, { trackedOnly: true });

		for (const channel of channels) {
			const summary = await getDailySummary(this.db, channel.id, today);

			if (!summary) {
				if (!channel.lastMessageAt) continue;
				await this.safeGenerate(channel.id, today, false, "scheduler");
				continue;
			}

			const generatedAt = summary.generatedAt?.getTime() ?? 0;
			const staleFor = Date.now() - generatedAt;
			const hasNewMessages = (channel.lastMessageAt?.getTime() ?? 0) > generatedAt;

			if (hasNewMessages && staleFor >= settings.todayRefreshMinutes * 60_000) {
				await this.safeGenerate(channel.id, today, false, "scheduler");
			}
		}
	}

	/**
	 * Any local day before today gets summarized once and frozen. Yesterday waits
	 * until the configured freeze time; older days (a worker that was down for a
	 * week) are caught up immediately.
	 */
	private async freezePastDays(): Promise<void> {
		const settings = await getSettings(this.db);
		const today = localToday(settings.timezone);
		const yesterday = shift(today, -1);
		const freezeAt = settings.freezeHourLocal * 60 + settings.freezeMinuteLocal;
		const pastFreezeTime = localMinutes(settings.timezone) >= freezeAt;

		const channels = await listChannels(this.db, { trackedOnly: true });
		let jobs = 0;

		for (const channel of channels) {
			if (jobs >= MAX_FREEZE_JOBS_PER_TICK) return;

			const days = await listActiveDays(
				this.db,
				channel.id,
				settings.timezone,
				settings.backfillDays,
			);

			for (const { day } of days) {
				if (jobs >= MAX_FREEZE_JOBS_PER_TICK) return;
				if (day >= today) continue;
				if (day === yesterday && !pastFreezeTime) continue;

				const summary = await getDailySummary(this.db, channel.id, day);
				if (summary?.frozen) continue;

				await this.safeGenerate(channel.id, day, true, "freeze");
				jobs++;
			}
		}
	}

	private async safeGenerate(
		channelId: string,
		day: string,
		freeze: boolean,
		trigger: "scheduler" | "freeze",
	) {
		try {
			await generateSummary(this.db, { channelId, day, freeze, trigger });
		} catch {
			// generateSummary already recorded the failure in summary_runs and logged it.
			// Swallowing here keeps one bad channel from stalling every other one.
		}
	}
}

function shift(day: string, delta: number): string {
	const d = new Date(`${day}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + delta);
	return d.toISOString().slice(0, 10);
}
