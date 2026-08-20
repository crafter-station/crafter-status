import { getSession, getSettings, isSessionLive, listApiTokens, listChannels } from "@crafter/db";
import QRCode from "qrcode";
import { ActionButton, ToggleTracked } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { SettingsForm } from "@/components/settings-form";
import { TokenManager } from "@/components/token-manager";
import { Badge, Dot, Panel, SectionLabel } from "@/components/ui";
import {
	logoutWhatsApp,
	mintToken,
	pairWhatsApp,
	refreshChannels,
	revokeToken,
	saveSettings,
	setChannelTracked,
} from "@/lib/actions";
import { requireAccess } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default async function SettingsPage() {
	const access = await requireAccess();
	const db = getDb();
	const isAdmin = access.role === "admin";

	const [session, settings, allChannels, tokens] = await Promise.all([
		getSession(db),
		getSettings(db),
		listChannels(db),
		listApiTokens(db, access.userId),
	]);

	const live = isSessionLive(session);
	const qrDataUrl =
		session.status === "qr_pending" && session.qr
			? await QRCode.toDataURL(session.qr, { margin: 1, width: 260 })
			: null;

	return (
		<div className="space-y-6">
			{session.status === "qr_pending" || session.status === "connecting" ? <AutoRefresh /> : null}

			<h1 className="text-lg font-semibold tracking-tight">Settings</h1>

			{/* ── WhatsApp connection ─────────────────────────────────────────── */}
			<Panel className="p-5">
				<div className="flex flex-wrap items-center gap-3">
					<h2 className="text-sm font-medium">WhatsApp connection</h2>
					<Badge tone={live ? "good" : session.status === "qr_pending" ? "warn" : "bad"}>
						<Dot tone={live ? "good" : session.status === "qr_pending" ? "warn" : "bad"} />
						{session.status}
					</Badge>
					<SectionLabel className="ml-auto">
						worker heartbeat {relativeTime(session.heartbeatAt)}
					</SectionLabel>
				</div>

				<dl className="mt-3 grid gap-x-6 gap-y-1 text-[0.8125rem] sm:grid-cols-2">
					<div className="flex gap-2">
						<dt className="text-[var(--muted)]">Number</dt>
						<dd className="font-mono">{session.phoneNumber ?? "—"}</dd>
					</div>
					<div className="flex gap-2">
						<dt className="text-[var(--muted)]">Name</dt>
						<dd>{session.pushName ?? "—"}</dd>
					</div>
					<div className="flex gap-2">
						<dt className="text-[var(--muted)]">Last ready</dt>
						<dd>{relativeTime(session.lastReadyAt)}</dd>
					</div>
					{session.lastError ? (
						<div className="flex gap-2 sm:col-span-2">
							<dt className="text-[var(--muted)]">Last error</dt>
							<dd className="text-[var(--danger)]">{session.lastError}</dd>
						</div>
					) : null}
				</dl>

				{qrDataUrl ? (
					<div className="mt-4 flex flex-col items-center gap-2 rounded-md border border-[var(--border)] p-4">
						{/* biome-ignore lint/performance/noImgElement: a data: URL QR that rotates every few seconds; next/image would only add a proxy hop. */}
						<img src={qrDataUrl} alt="WhatsApp pairing QR code" width={260} height={260} />
						<p className="text-center text-[0.8125rem] text-[var(--muted)]">
							WhatsApp → Settings → Linked devices → Link a device
						</p>
						<SectionLabel>this code rotates automatically</SectionLabel>
					</div>
				) : null}

				{isAdmin ? (
					<div className="mt-4 flex flex-wrap gap-2">
						<ActionButton action={pairWhatsApp} pendingLabel="Starting…" variant="default">
							{session.status === "connected" ? "Reconnect" : "Pair WhatsApp"}
						</ActionButton>
						<ActionButton action={refreshChannels} pendingLabel="Scanning…">
							Refresh group list
						</ActionButton>
						<ActionButton
							action={logoutWhatsApp}
							variant="danger"
							confirm="Unlink WhatsApp? Someone will have to scan a new QR code to resume ingestion."
						>
							Unlink
						</ActionButton>
					</div>
				) : (
					<p className="mt-4 text-[0.8125rem] text-[var(--muted)]">
						Only GitHub organization owners can change the WhatsApp connection.
					</p>
				)}
			</Panel>

			{/* ── Channels ────────────────────────────────────────────────────── */}
			<Panel className="p-5">
				<div className="flex items-center justify-between">
					<h2 className="text-sm font-medium">Channels</h2>
					<SectionLabel>
						{allChannels.filter((c) => c.tracked).length}/{allChannels.length} tracked
					</SectionLabel>
				</div>
				<p className="mt-1 text-[0.8125rem] text-[var(--muted)]">
					Only tracked channels have their messages stored. Everything else is catalogued by name
					alone. Disabling keeps the history already collected.
				</p>

				{allChannels.length === 0 ? (
					<p className="mt-4 text-[0.8125rem] text-[var(--muted)]">
						No groups discovered yet. Pair WhatsApp, then refresh the group list.
					</p>
				) : (
					<ul className="mt-3 divide-y divide-[var(--border)]">
						{allChannels.map((channel) => (
							<li key={channel.id} className="flex items-center gap-3 py-2">
								<div className="min-w-0 flex-1">
									<p className="truncate text-[0.8125rem]">{channel.name}</p>
									<p className="font-mono text-[0.6875rem] text-[var(--muted)]">
										{channel.participantCount} members · last message{" "}
										{relativeTime(channel.lastMessageAt)}
									</p>
								</div>
								{isAdmin ? (
									<ToggleTracked
										tracked={channel.tracked}
										label={channel.name}
										action={setChannelTracked.bind(null, channel.id)}
									/>
								) : (
									<Badge tone={channel.tracked ? "good" : "neutral"}>
										{channel.tracked ? "tracked" : "off"}
									</Badge>
								)}
							</li>
						))}
					</ul>
				)}
			</Panel>

			{/* ── Workspace ───────────────────────────────────────────────────── */}
			{isAdmin ? (
				<Panel className="p-5">
					<h2 className="text-sm font-medium">Workspace</h2>
					<SettingsForm
						save={saveSettings}
						timezone={settings.timezone}
						todayRefreshMinutes={settings.todayRefreshMinutes}
						summaryModel={settings.summaryModel}
					/>
				</Panel>
			) : null}

			{/* ── MCP ─────────────────────────────────────────────────────────── */}
			<Panel className="p-5">
				<h2 className="text-sm font-medium">MCP endpoint</h2>
				<p className="mt-1 text-[0.8125rem] text-[var(--muted)]">
					Connect Claude, Claude Code, ChatGPT or Codex to this workspace. Clients that support
					OAuth will send you through GitHub automatically — no token needed.
				</p>
				<code className="mt-3 block rounded-md border border-[var(--border)] px-3 py-2 font-mono text-[0.75rem]">
					{APP_URL}/mcp
				</code>

				<div className="mt-5">
					<SectionLabel>Personal tokens (fallback for clients without OAuth)</SectionLabel>
					<div className="mt-2">
						<TokenManager
							tokens={tokens.map((t) => ({
								id: t.id,
								name: t.name,
								prefix: t.prefix,
								lastUsedAt: t.lastUsedAt,
								revokedAt: t.revokedAt,
								createdAt: t.createdAt,
							}))}
							mint={mintToken}
							revoke={revokeToken}
						/>
					</div>
				</div>
			</Panel>
		</div>
	);
}
