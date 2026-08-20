import { getChannel, getDailySummary, getSettings, listActiveDays, localToday } from "@crafter/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { ActionButton } from "@/components/action-button";
import { Badge, EmptyState, Panel, SectionLabel } from "@/components/ui";
import { regenerateSummary } from "@/lib/actions";
import { requireAccess } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatDay, relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = {
	params: Promise<{ channelId: string }>;
	searchParams: Promise<{ day?: string }>;
};

export default async function ChannelPage({ params, searchParams }: Props) {
	await requireAccess();

	const { channelId: rawId } = await params;
	const channelId = decodeURIComponent(rawId);
	const { day: requestedDay } = await searchParams;

	const db = getDb();
	const channel = await getChannel(db, channelId);
	if (!channel) notFound();

	const settings = await getSettings(db);
	const today = localToday(settings.timezone);
	const days = await listActiveDays(db, channelId, settings.timezone, settings.backfillDays);

	const selectedDay = requestedDay ?? days[0]?.day ?? today;
	const summary = await getDailySummary(db, channelId, selectedDay);
	const dayMeta = days.find((d) => d.day === selectedDay);

	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<div>
					<Link href="/" className="text-[0.75rem] text-[var(--muted)] hover:text-[var(--fg)]">
						← all channels
					</Link>
					<h1 className="mt-1 text-lg font-semibold tracking-tight">{channel.name}</h1>
					<p className="font-mono text-[0.6875rem] text-[var(--muted)]">
						{channel.participantCount} members · {channel.tracked ? "tracked" : "not tracked"}
					</p>
				</div>
				<ActionButton
					action={regenerateSummary.bind(null, channelId, selectedDay)}
					pendingLabel="Summarizing…"
				>
					Regenerate
				</ActionButton>
			</div>

			<div className="grid gap-4 lg:grid-cols-[13rem_1fr]">
				<aside className="lg:sticky lg:top-20 lg:self-start">
					<SectionLabel>Days</SectionLabel>
					<div className="mt-2 max-h-[70dvh] space-y-0.5 overflow-y-auto pr-1">
						{days.length === 0 ? (
							<p className="text-[0.8125rem] text-[var(--muted)]">No messages stored yet.</p>
						) : (
							days.map((d) => {
								const active = d.day === selectedDay;
								return (
									<Link
										key={d.day}
										href={`/c/${encodeURIComponent(channelId)}?day=${d.day}`}
										className={`flex items-center justify-between rounded px-2 py-1.5 text-[0.8125rem] transition ${
											active
												? "bg-[var(--border)]/60 text-[var(--fg)]"
												: "text-[var(--muted)] hover:bg-[var(--border)]/30"
										}`}
									>
										<span className="font-mono">{d.day}</span>
										<span className="font-mono text-[0.6875rem] opacity-70">{d.messageCount}</span>
									</Link>
								);
							})
						)}
					</div>
				</aside>

				<Panel className="p-5">
					<div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3">
						<h2 className="text-sm font-medium">{formatDay(selectedDay, settings.timezone)}</h2>
						<Badge>{dayMeta?.messageCount ?? summary?.messageCount ?? 0} messages</Badge>
						{selectedDay === today ? (
							<Badge tone="warn">live</Badge>
						) : summary?.frozen ? (
							<Badge tone="good">frozen</Badge>
						) : null}
						<SectionLabel className="ml-auto">
							{summary ? `generated ${relativeTime(summary.generatedAt)}` : "not generated"}
						</SectionLabel>
					</div>

					{summary ? (
						<article className="prose-summary mt-4">
							<ReactMarkdown>{summary.markdown || summary.tldr}</ReactMarkdown>
						</article>
					) : (
						<div className="mt-4">
							<EmptyState
								title="No summary for this day."
								hint={
									dayMeta
										? "Press Regenerate to build one now."
										: "There are no stored messages for this day."
								}
							/>
						</div>
					)}
				</Panel>
			</div>
		</div>
	);
}
