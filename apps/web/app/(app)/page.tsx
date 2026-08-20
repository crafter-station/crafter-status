import { getSettings, getSummariesInRange, listChannels, localToday } from "@crafter/db";
import Link from "next/link";
import { Badge, EmptyState, Panel, SectionLabel } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatDay, relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
	const access = await requireAccess();
	const db = getDb();

	const settings = await getSettings(db);
	const today = localToday(settings.timezone);
	const channels = await listChannels(db, { trackedOnly: true });

	const summaries = await getSummariesInRange(db, {
		channelIds: channels.map((c) => c.id),
		from: today,
		to: today,
	});
	const byChannel = new Map(summaries.map((s) => [s.channelId, s]));

	return (
		<div className="space-y-5">
			<div className="flex items-baseline justify-between">
				<div>
					<h1 className="text-lg font-semibold tracking-tight">Today</h1>
					<p className="text-[0.8125rem] text-[var(--muted)]">
						{formatDay(today, settings.timezone)}
					</p>
				</div>
				<SectionLabel>
					{channels.length} tracked channel{channels.length === 1 ? "" : "s"}
				</SectionLabel>
			</div>

			{channels.length === 0 ? (
				<EmptyState
					title="No channels are being tracked yet."
					hint={
						access.role === "admin"
							? "Open Settings to pair WhatsApp and switch on the groups you want summarized."
							: "Ask an organization owner to enable channels in Settings."
					}
				/>
			) : (
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{channels.map((channel) => {
						const summary = byChannel.get(channel.id);
						const counts = summary
							? [
									summary.decisions.length > 0 ? `${summary.decisions.length} decisions` : null,
									summary.actionItems.length > 0 ? `${summary.actionItems.length} actions` : null,
									summary.openQuestions.length > 0
										? `${summary.openQuestions.length} questions`
										: null,
								].filter(Boolean)
							: [];

						return (
							<Link
								key={channel.id}
								href={`/c/${encodeURIComponent(channel.id)}`}
								className="group"
							>
								<Panel className="flex h-full flex-col gap-3 p-4 transition group-hover:border-[var(--muted)]">
									<div className="flex items-start justify-between gap-2">
										<h2 className="text-sm font-medium leading-snug">{channel.name}</h2>
										<Badge tone={summary && summary.messageCount > 0 ? "good" : "neutral"}>
											{summary?.messageCount ?? 0} msg
										</Badge>
									</div>

									<p className="line-clamp-5 flex-1 text-[0.8125rem] leading-relaxed text-[var(--muted)]">
										{summary?.tldr || "No summary yet for today."}
									</p>

									<div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--border)] pt-2">
										{counts.length > 0 ? (
											counts.map((c) => <SectionLabel key={c as string}>{c}</SectionLabel>)
										) : (
											<SectionLabel>quiet</SectionLabel>
										)}
										<SectionLabel className="ml-auto">
											{relativeTime(summary?.generatedAt ?? null)}
										</SectionLabel>
									</div>
								</Panel>
							</Link>
						);
					})}
				</div>
			)}
		</div>
	);
}
