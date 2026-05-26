import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import qrcode from "qrcode-terminal";
import wwebjs from "whatsapp-web.js";
import { AppError } from "../cli/error-map.ts";
import { SESSION_DIR } from "../constants.ts";
import type { GroupMessage, GroupSummary, GroupTranscript } from "../types.ts";

const { Client, LocalAuth } = wwebjs;

export type WhatsAppHandle = {
	client: InstanceType<typeof Client>;
	close: () => Promise<void>;
};

type InitOptions = {
	/** Called when WhatsApp Web asks for a QR pairing. If absent, a QR event means the session is unauthenticated and init rejects. */
	onQR?: (qr: string) => void;
	/** Print lifecycle events to stderr. */
	verbose?: boolean;
	headless?: boolean;
};

export async function initWhatsApp(opts: InitOptions = {}): Promise<WhatsAppHandle> {
	const client = new Client({
		authStrategy: new LocalAuth({ clientId: "crafter", dataPath: SESSION_DIR }),
		puppeteer: {
			headless: opts.headless ?? true,
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		},
	});

	const log = (msg: string) => {
		if (opts.verbose) process.stderr.write(`  · ${msg}\n`);
	};

	const ready = new Promise<void>((resolve, reject) => {
		client.once("ready", () => {
			log("ready");
			resolve();
		});
		client.once("authenticated", () => log("authenticated"));
		client.once("auth_failure", (msg: string) => reject(new Error(`Auth failure: ${msg}`)));
		client.on("loading_screen", (percent, message) => log(`loading ${percent}% ${message}`));

		client.on("qr", (qr: string) => {
			if (opts.onQR) {
				opts.onQR(qr);
			} else {
				reject(
					new AppError("NOT_AUTHENTICATED", {
						human: "WhatsApp session is not authenticated.",
						hint: "Run `crafter login` to pair your account by scanning a QR code.",
					}),
				);
			}
		});
	});

	await client.initialize();
	await ready;

	return {
		client,
		close: async () => {
			await client.destroy();
		},
	};
}

export function renderQR(qr: string): void {
	qrcode.generate(qr, { small: true });
}

export async function listGroups(client: InstanceType<typeof Client>): Promise<GroupSummary[]> {
	const chats = await client.getChats();
	return chats
		.filter((c) => c.isGroup)
		.map((c) => {
			// GroupChat extends Chat; participants is on GroupChat.
			const group = c as typeof c & { participants?: unknown[] };
			return {
				id: c.id._serialized,
				name: c.name,
				participantCount: Array.isArray(group.participants) ? group.participants.length : 0,
			};
		});
}

export async function fetchGroupTranscript(
	client: InstanceType<typeof Client>,
	groupId: string,
	limit: number,
): Promise<GroupTranscript> {
	const chat = await client.getChatById(groupId);
	if (!chat.isGroup) {
		throw new Error(`Chat ${groupId} is not a group.`);
	}

	const raw = await chat.fetchMessages({ limit });
	const messages: GroupMessage[] = raw.map((m) => ({
		id: m.id._serialized,
		timestamp: m.timestamp * 1000,
		from: m.from,
		author: m.author ?? null,
		body: m.body ?? "",
		type: m.type,
	}));

	const group = chat as typeof chat & { participants?: unknown[] };

	return {
		group: {
			id: chat.id._serialized,
			name: chat.name,
			participantCount: Array.isArray(group.participants) ? group.participants.length : 0,
		},
		messages,
	};
}

/**
 * True only when a *paired* WhatsApp session exists. The Chromium profile dir gets
 * created on first puppeteer launch even without auth, so checking SESSION_DIR alone
 * gives false positives. WhatsApp Web's auth state lives in the IndexedDB folder for
 * web.whatsapp.com — its presence (with files) means we've actually paired.
 */
export function sessionExists(): boolean {
	const idbDir = join(
		SESSION_DIR,
		"session-crafter",
		"Default",
		"IndexedDB",
		"https_web.whatsapp.com_0.indexeddb.leveldb",
	);
	if (!existsSync(idbDir)) return false;
	try {
		return readdirSync(idbDir).length > 0;
	} catch {
		return false;
	}
}

export function clearSession(): void {
	if (existsSync(SESSION_DIR)) {
		rmSync(SESSION_DIR, { recursive: true, force: true });
	}
}

export { qrcode };
