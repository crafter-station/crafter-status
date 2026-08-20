import { UserButton } from "@clerk/nextjs";
import { getSession, getSettings, isSessionLive } from "@crafter/db";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Dot } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
	const access = await requireAccess();
	const db = getDb();
	const [session, settings] = await Promise.all([getSession(db), getSettings(db)]);
	const live = isSessionLive(session);

	return (
		<div className="min-h-dvh">
			<header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--bg)]/85 backdrop-blur">
				<div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-5">
					<Link href="/" className="font-mono text-[0.8125rem] font-semibold tracking-tight">
						crafter<span className="text-[var(--muted)]">/status</span>
					</Link>

					<nav className="flex items-center gap-1 text-[0.8125rem]">
						<Link href="/" className="rounded px-2 py-1 text-[var(--muted)] hover:text-[var(--fg)]">
							Channels
						</Link>
						{access.role === "admin" ? (
							<Link
								href="/settings"
								className="rounded px-2 py-1 text-[var(--muted)] hover:text-[var(--fg)]"
							>
								Settings
							</Link>
						) : null}
					</nav>

					<div className="ml-auto flex items-center gap-3">
						<Badge tone={live ? "good" : "bad"}>
							<Dot tone={live ? "good" : "bad"} />
							{live ? "live" : session.status}
						</Badge>
						<span className="hidden font-mono text-[0.6875rem] text-[var(--muted)] sm:inline">
							{settings.timezone}
						</span>
						<UserButton />
					</div>
				</div>

				{!live ? (
					<div className="border-t border-[var(--danger)]/30 bg-[var(--danger)]/10 px-5 py-1.5 text-center text-[0.75rem] text-[var(--danger)]">
						WhatsApp mirror is not live — last seen {relativeTime(session.heartbeatAt)}. Summaries
						below may be missing recent messages.
					</div>
				) : null}
			</header>

			<main className="mx-auto max-w-6xl px-5 py-6">{children}</main>
		</div>
	);
}
