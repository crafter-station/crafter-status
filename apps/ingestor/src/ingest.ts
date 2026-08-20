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

function bodyOf(message: { body?: string; caption?: string }): string {
	return message.body || message.caption || "";
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
export async function backfillChannel(
	db: Database,
	client: WhatsAppClient,
	channelId: string,
): Promise<number> {
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

			return msgs.map((m) => {
				try {
					return win.WWebJS.getMessageModel(m);
				} catch {
					// One unserializable message must not cost us the rest of the history.
					return null;
				}
			});
		},
		channelId,
		settings.backfillMessageLimit,
	);

	const cutoff = Date.now() - settings.backfillDays * 24 * 60 * 60 * 1000;
	const rows: NewMessage[] = [];

	for (const m of (raw ?? []) as (RawMessage | null)[]) {
		if (!m?.id?._serialized || typeof m.t !== "number") continue;
		const timestamp = m.t * 1000;
		if (timestamp < cutoff) continue;

		rows.push({
			id: m.id._serialized,
			channelId,
			authorJid: m.author ?? m.from ?? null,
			authorName: m.notifyName ?? null,
			body: bodyOf(m),
			type: m.type ?? "chat",
			hasMedia: Boolean(m.hasMedia),
			timestamp: new Date(timestamp),
			fromMe: Boolean(m.id.fromMe),
			quotedMessageId: m.quotedStanzaID ?? null,
		});
	}

	if (rows.length === 0) return 0;
	return insertMessages(db, rows);
}
