"use server";

import {
	channels,
	createApiToken,
	getSettings,
	listApiTokens,
	localToday,
	recordAudit,
	revokeApiToken,
	updateSettings,
} from "@crafter/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAccess, requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ingestor } from "@/lib/ingestor";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

async function guard(fn: () => Promise<ActionResult>): Promise<ActionResult> {
	try {
		return await fn();
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

export async function pairWhatsApp(): Promise<ActionResult> {
	return guard(async () => {
		const access = await requireAdmin();
		await ingestor.pair();
		await recordAudit(getDb(), {
			actorUserId: access.userId,
			actorLabel: access.githubLogin,
			action: "whatsapp.pair_requested",
		});
		revalidatePath("/settings");
		return { ok: true, message: "Pairing started — a QR code will appear shortly." };
	});
}

export async function logoutWhatsApp(): Promise<ActionResult> {
	return guard(async () => {
		const access = await requireAdmin();
		await ingestor.logout();
		await recordAudit(getDb(), {
			actorUserId: access.userId,
			actorLabel: access.githubLogin,
			action: "whatsapp.logout",
		});
		revalidatePath("/settings");
		return { ok: true, message: "WhatsApp unlinked." };
	});
}

export async function refreshChannels(): Promise<ActionResult> {
	return guard(async () => {
		await requireAdmin();
		const { count } = await ingestor.refreshChannels();
		revalidatePath("/settings");
		return { ok: true, message: `Found ${count} groups.` };
	});
}

/**
 * Enabling a channel starts persisting its messages, so it is an audited admin
 * action and immediately triggers a bounded history backfill.
 */
export async function setChannelTracked(
	channelId: string,
	tracked: boolean,
): Promise<ActionResult> {
	return guard(async () => {
		const access = await requireAdmin();
		const db = getDb();

		await db
			.update(channels)
			.set({
				tracked,
				trackedAt: tracked ? new Date() : null,
				trackedByUserId: tracked ? access.userId : null,
				updatedAt: new Date(),
			})
			.where(eq(channels.id, channelId));

		await recordAudit(db, {
			actorUserId: access.userId,
			actorLabel: access.githubLogin,
			action: tracked ? "channel.tracked" : "channel.untracked",
			targetType: "channel",
			targetId: channelId,
		});

		let message = tracked ? "Channel enabled." : "Channel disabled. Existing history is kept.";

		if (tracked) {
			try {
				const { inserted, fetched, withinWindow } = await ingestor.backfill(channelId);
				await db
					.update(channels)
					.set({ backfilledAt: new Date() })
					.where(eq(channels.id, channelId));
				message =
					inserted > 0
						? `Channel enabled — backfilled ${inserted} messages.`
						: `Channel enabled, but nothing was stored: WhatsApp returned ${fetched} messages, ${withinWindow} inside the ${"30"}-day window.`;
			} catch (e) {
				message = `Channel enabled, but backfill failed: ${e instanceof Error ? e.message : String(e)}`;
			}
		}

		revalidatePath("/settings");
		revalidatePath("/");
		return { ok: true, message };
	});
}

export async function regenerateSummary(channelId: string, day?: string): Promise<ActionResult> {
	return guard(async () => {
		await requireAccess();
		const db = getDb();
		const settings = await getSettings(db);
		const target = day ?? localToday(settings.timezone);

		await ingestor.regenerate(channelId, target);
		revalidatePath(`/c/${channelId}`);
		revalidatePath("/");
		return { ok: true, message: `Regenerated ${target}.` };
	});
}

export async function saveSettings(formData: FormData): Promise<ActionResult> {
	return guard(async () => {
		const access = await requireAdmin();
		const db = getDb();

		const timezone = String(formData.get("timezone") ?? "").trim();
		const todayRefreshMinutes = Number(formData.get("todayRefreshMinutes") ?? 30);
		const summaryModel = String(formData.get("summaryModel") ?? "").trim();

		if (!timezone) return { ok: false, error: "Timezone is required." };
		try {
			new Intl.DateTimeFormat("en", { timeZone: timezone });
		} catch {
			return { ok: false, error: `"${timezone}" is not a valid IANA timezone.` };
		}
		if (!Number.isFinite(todayRefreshMinutes) || todayRefreshMinutes < 5) {
			return { ok: false, error: "Refresh interval must be at least 5 minutes." };
		}

		await updateSettings(db, { timezone, todayRefreshMinutes, summaryModel });
		await recordAudit(db, {
			actorUserId: access.userId,
			actorLabel: access.githubLogin,
			action: "settings.updated",
			metadata: { timezone, todayRefreshMinutes, summaryModel },
		});

		revalidatePath("/settings");
		revalidatePath("/");
		return { ok: true, message: "Settings saved." };
	});
}

export type TokenResult = ActionResult & { plaintext?: string };

export async function mintToken(formData: FormData): Promise<TokenResult> {
	try {
		const access = await requireAccess();
		const db = getDb();
		const name = String(formData.get("name") ?? "").trim() || "Untitled token";

		const token = await createApiToken(db, { userId: access.userId, name });
		await recordAudit(db, {
			actorUserId: access.userId,
			actorLabel: access.githubLogin,
			action: "token.created",
			targetType: "api_token",
			targetId: token.id,
			metadata: { name },
		});

		revalidatePath("/settings");
		return {
			ok: true,
			plaintext: token.plaintext,
			message: "Copy this token now — it is not shown again.",
		};
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

export async function revokeToken(tokenId: string): Promise<ActionResult> {
	return guard(async () => {
		const access = await requireAccess();
		const db = getDb();
		const revoked = await revokeApiToken(db, access.userId, tokenId);
		if (!revoked) return { ok: false, error: "Token not found or already revoked." };

		await recordAudit(db, {
			actorUserId: access.userId,
			actorLabel: access.githubLogin,
			action: "token.revoked",
			targetType: "api_token",
			targetId: tokenId,
		});
		revalidatePath("/settings");
		return { ok: true, message: "Token revoked." };
	});
}

export async function listMyTokens() {
	const access = await requireAccess();
	return listApiTokens(getDb(), access.userId);
}
