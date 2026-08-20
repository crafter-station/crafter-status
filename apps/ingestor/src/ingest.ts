import type { Database, NewMessage } from "@crafter/db";
import { getChannel, getSettings, insertMessages, upsertChannels } from "@crafter/db";
import type wwebjs from "whatsapp-web.js";
import type { WhatsAppClient } from "./whatsapp.ts";

type WaMessage = wwebjs.Message;

/** Raw serialized message as WhatsApp Web's own store holds it. */
type RawMessage = {
	id?: { _serialized?: string; fromMe?: boolean };
	from?: string;
	to?: string;
	author?: string;
	notifyName?: string;
	body?: string;
	caption?: string;
	type?: string;
	t?: number;
	hasMedia?: boolean;
	quotedStanzaID?: string;
};

/** Flattened message as the page hands it back, with ids already serialized. */
type PagedMessage = {
	id: string | null;
	from: string | null;
	to: string | null;
	author: string | null;
	fromMe: boolean;
	t: number | null;
	body: string;
	type: string;
	hasMedia: boolean;
	notifyName: string | null;
	quotedStanzaID: string | null;
};

/**
 * Which group a message belongs to, without asking for a chat model.
 *
 * `getChat()` builds a full model, and on a profile with damaged chats that
 * throws — the same DataError that hid the group list. The routing information
 * is already on the message: for an incoming message `from` is the group, and
 * for one we sent it is `to`.
 */
function channelIdOf(message: { from?: string; to?: string; fromMe?: boolean }): string | null {
	const jid = message.fromMe ? message.to : message.from;
	return jid?.endsWith("@g.us") ? jid : null;
}

/**
 * Live path: one message off the socket. Untracked groups are catalogued by name
 * and id only — their content is never written.
 *
 * Reads only fields already present on the message. The display name comes from
 * `notifyName`, which WhatsApp attaches to the message itself, rather than from
 * `getContact()` — another model build that fails on damaged profiles, and a round
 * trip per message besides.
 */
export async function ingestMessage(db: Database, message: WaMessage): Promise<void> {
	const raw = (message as unknown as { _data?: RawMessage })._data ?? {};

	const channelId = channelIdOf({
		from: message.from,
		to: message.to,
		fromMe: message.fromMe,
	});
	if (!channelId) return;

	const channel = await getChannel(db, channelId);

	if (!channel) {
		// A group we have never seen. Catalogue the id so it appears in settings;
		// the name arrives with the next catalogue refresh.
		await upsertChannels(db, [{ id: channelId, name: channelId, participantCount: 0 }]);
		return;
	}

	if (!channel.tracked) return;

	await insertMessages(db, [
		{
			id: message.id._serialized,
			channelId,
			authorJid: message.author ?? message.from ?? null,
			authorName: raw.notifyName ?? null,
			body: message.body ?? "",
			type: message.type ?? "chat",
			hasMedia: Boolean(message.hasMedia),
			// whatsapp-web.js reports seconds since epoch.
			timestamp: new Date(message.timestamp * 1000),
			fromMe: Boolean(message.fromMe),
			quotedMessageId: raw.quotedStanzaID ?? null,
		},
	]);
}

/**
 * History path: used when a channel is first tracked and again after every
 * reconnect. Bounded by the configured message limit and day window, since
 * WhatsApp Web only ever synced a recent slice of history to this profile anyway.
 *
 * This is `Chat.fetchMessages` inlined. The library's version is safe in itself —
 * it reads the chat with `getAsModel: false` — but reaching it requires
 * `getChatById()`, which builds the model that throws on damaged chats. Going
 * straight to the store skips that.
 */
export type BackfillResult = {
	/** Messages the store handed back at all. */
	fetched: number;
	/** Of those, how many could be read (the rest were unparseable). */
	parsed: number;
	/** Of those, how many fell inside the configured day window. */
	withinWindow: number;
	/** Of those, how many were new. */
	inserted: number;
};

export async function backfillChannel(
	db: Database,
	client: WhatsAppClient,
	channelId: string,
): Promise<BackfillResult> {
	const settings = await getSettings(db);
	const page = (
		client as unknown as {
			pupPage: { evaluate: <T>(fn: (...a: any[]) => T, ...args: any[]) => Promise<T> };
		}
	).pupPage;

	const raw = await page.evaluate(
		async (chatId: string, limit: number) => {
			const win = (globalThis as unknown as { window: Record<string, any> }).window;
			const keep = (m: any) => !m.isNotification;

			const chat = await win.WWebJS.getChat(chatId, { getAsModel: false });
			let msgs: any[] = chat.msgs.getModelsArray().filter(keep);

			while (msgs.length < limit) {
				const earlier = await win.require("WAWebChatLoadMessages").loadEarlierMsgs({ chat });
				if (!earlier || !earlier.length) break;
				msgs = [...earlier.filter(keep), ...msgs];
			}

			msgs.sort((a, b) => (a.t > b.t ? 1 : -1));
			if (msgs.length > limit) msgs = msgs.slice(msgs.length - limit);

			// Fields are read off the model directly rather than through
			// WWebJS.getMessageModel(). That serializer pulls in WALinkify and other
			// modules for link detection and button payloads we never look at, and if
			// any of them fails to resolve it throws for every message at once — which
			// is indistinguishable from a chat with no history.
			const idOf = (v: any): string | null =>
				typeof v === "string" ? v : (v?._serialized ?? null);

			return msgs.map((m) => {
				try {
					return {
						id: idOf(m.id),
						from: idOf(m.from),
						to: idOf(m.to),
						author: idOf(m.author),
						fromMe: Boolean(m.id?.fromMe),
						t: typeof m.t === "number" ? m.t : null,
						body: m.body ?? m.caption ?? "",
						type: m.type ?? "chat",
						hasMedia: Boolean(m.mediaData || m.directPath),
						notifyName: m.notifyName ?? null,
						quotedStanzaID: m.quotedStanzaID ?? null,
					};
				} catch {
					// One unreadable message must not cost us the rest of the history.
					return null;
				}
			});
		},
		channelId,
		settings.backfillMessageLimit,
	);

	const cutoff = Date.now() - settings.backfillDays * 24 * 60 * 60 * 1000;
	const list = (raw ?? []) as (PagedMessage | null)[];
	const rows: NewMessage[] = [];
	let parsed = 0;

	for (const m of list) {
		if (!m?.id || typeof m.t !== "number") continue;
		parsed++;

		const timestamp = m.t * 1000;
		if (timestamp < cutoff) continue;

		rows.push({
			id: m.id,
			channelId,
			authorJid: m.author ?? m.from ?? null,
			authorName: m.notifyName ?? null,
			body: m.body ?? "",
			type: m.type ?? "chat",
			hasMedia: Boolean(m.hasMedia),
			timestamp: new Date(timestamp),
			fromMe: Boolean(m.fromMe),
			quotedMessageId: m.quotedStanzaID ?? null,
		});
	}

	const fetched = list.length;
	if (rows.length === 0) return { fetched, parsed, withinWindow: 0, inserted: 0 };

	return { fetched, parsed, withinWindow: rows.length, inserted: await insertMessages(db, rows) };
}
