import type { Database, NewMessage } from "@crafter/db";
import { getChannel, getSettings, insertMessages, upsertChannels } from "@crafter/db";
import type wwebjs from "whatsapp-web.js";
import type { WhatsAppClient } from "./whatsapp.ts";

type WaMessage = wwebjs.Message;

/**
 * Display names cost a round trip to the WhatsApp store each time, and a busy group
 * repeats the same handful of senders all day. Cached for the process lifetime;
 * a rename shows up after the next restart, which is an acceptable trade.
 */
const nameCache = new Map<string, string | null>();

async function resolveAuthorName(message: WaMessage): Promise<string | null> {
	const jid = message.author ?? message.from;
	if (!jid) return null;

	const cached = nameCache.get(jid);
	if (cached !== undefined) return cached;

	let name: string | null = null;
	try {
		const contact = await message.getContact();
		name = contact.pushname || contact.name || contact.number || null;
	} catch {
		name = null;
	}

	nameCache.set(jid, name);
	return name;
}

async function toRow(message: WaMessage, channelId: string): Promise<NewMessage> {
	return {
		id: message.id._serialized,
		channelId,
		authorJid: message.author ?? message.from ?? null,
		authorName: await resolveAuthorName(message),
		body: message.body ?? "",
		type: message.type ?? "chat",
		hasMedia: Boolean(message.hasMedia),
		// whatsapp-web.js reports seconds since epoch.
		timestamp: new Date(message.timestamp * 1000),
		fromMe: Boolean(message.fromMe),
		quotedMessageId: message.hasQuotedMsg
			? ((message as unknown as { _data?: { quotedStanzaID?: string } })._data?.quotedStanzaID ??
				null)
			: null,
	};
}

/**
 * Live path: one message off the socket. Untracked groups are catalogued by name
 * and id only — their content is never written.
 */
export async function ingestMessage(db: Database, message: WaMessage): Promise<void> {
	const chat = await message.getChat();
	if (!chat.isGroup) return;

	const channelId = chat.id._serialized;
	const channel = await getChannel(db, channelId);

	if (!channel) {
		const group = chat as typeof chat & { participants?: unknown[] };
		await upsertChannels(db, [
			{
				id: channelId,
				name: chat.name,
				participantCount: Array.isArray(group.participants) ? group.participants.length : 0,
			},
		]);
		return;
	}

	if (!channel.tracked) return;

	await insertMessages(db, [await toRow(message, channelId)]);
}

/**
 * History path: used when a channel is first tracked and again after every
 * reconnect. Bounded by the configured message limit and day window, since
 * WhatsApp Web only ever synced a recent slice of history to this profile anyway.
 */
export async function backfillChannel(
	db: Database,
	client: WhatsAppClient,
	channelId: string,
): Promise<number> {
	const settings = await getSettings(db);
	const chat = await client.getChatById(channelId);
	if (!chat.isGroup) return 0;

	const cutoff = Date.now() - settings.backfillDays * 24 * 60 * 60 * 1000;
	const raw = await chat.fetchMessages({ limit: settings.backfillMessageLimit });

	const rows: NewMessage[] = [];
	for (const message of raw) {
		if (message.timestamp * 1000 < cutoff) continue;
		rows.push(await toRow(message, channelId));
	}

	if (rows.length === 0) return 0;
	return insertMessages(db, rows);
}
