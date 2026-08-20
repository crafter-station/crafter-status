import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "@crafter/db";
import { updateSession, upsertChannels } from "@crafter/db";
import wwebjs from "whatsapp-web.js";
import { env } from "./env.ts";
import { backfillChannel, ingestMessage } from "./ingest.ts";
import { log } from "./log.ts";

const { Client, LocalAuth } = wwebjs;

export type WhatsAppClient = InstanceType<typeof Client>;

/**
 * Owns the single shared WhatsApp session. Everything about connection state is
 * mirrored into Postgres so the dashboard (a separate process) can render it and
 * so MCP callers can be told when the mirror has gone stale.
 */
export class WhatsAppRunner {
	private client: WhatsAppClient | null = null;
	private starting = false;

	constructor(private readonly db: Database) {}

	get instance(): WhatsAppClient | null {
		return this.client;
	}

	get isReady(): boolean {
		return this.client !== null && !this.starting;
	}

	/** Boot the client. Safe to call repeatedly; concurrent calls collapse into one. */
	async start(): Promise<void> {
		if (this.client || this.starting) return;
		this.starting = true;

		await updateSession(this.db, { status: "connecting", lastError: null });

		const client = new Client({
			authStrategy: new LocalAuth({ clientId: "crafter", dataPath: env.sessionDir }),
			puppeteer: {
				headless: env.headless,
				args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
			},
		});

		client.on("qr", async (qr: string) => {
			log.info("QR issued — waiting for a scan in the dashboard");
			await updateSession(this.db, { status: "qr_pending", qr, qrGeneratedAt: new Date() });
		});

		client.on("authenticated", () => log.info("authenticated"));

		client.on("auth_failure", async (msg: string) => {
			log.error(`auth failure: ${msg}`);
			await updateSession(this.db, { status: "disconnected", lastError: msg, qr: null });
		});

		client.on("ready", async () => {
			log.info("ready");
			const me = client.info?.wid?.user ?? null;
			await updateSession(this.db, {
				status: "connected",
				qr: null,
				qrGeneratedAt: null,
				phoneNumber: me,
				pushName: client.info?.pushname ?? null,
				lastReadyAt: new Date(),
				lastError: null,
				heartbeatAt: new Date(),
			});
			await this.refreshChannels();
			// Heal whatever we missed while disconnected. Upserts keyed on WhatsApp's
			// own message id make an overlapping replay free.
			await this.backfillTracked("reconnect");
		});

		client.on("disconnected", async (reason: string) => {
			log.warn(`disconnected: ${reason}`);
			await updateSession(this.db, {
				status: "disconnected",
				lastDisconnectedAt: new Date(),
				lastError: `disconnected: ${reason}`,
			});
			this.client = null;
		});

		client.on("message_create", async (message) => {
			try {
				await ingestMessage(this.db, message);
			} catch (e) {
				log.error(`ingest failed: ${e instanceof Error ? e.message : String(e)}`);
			}
		});

		this.client = client;
		try {
			await client.initialize();
		} catch (e) {
			this.client = null;
			const msg = e instanceof Error ? e.message : String(e);
			await updateSession(this.db, { status: "disconnected", lastError: msg });
			throw e;
		} finally {
			this.starting = false;
		}
	}

	async stop(): Promise<void> {
		if (!this.client) return;
		try {
			await this.client.destroy();
		} finally {
			this.client = null;
		}
	}

	/** Unlink the phone and wipe the profile, forcing a fresh QR on next start. */
	async logout(): Promise<void> {
		if (this.client) {
			try {
				await this.client.logout();
			} catch {
				// Already gone; fall through to wiping local state.
			}
			await this.stop();
		}
		if (existsSync(env.sessionDir)) {
			rmSync(env.sessionDir, { recursive: true, force: true });
		}
		await updateSession(this.db, {
			status: "disconnected",
			qr: null,
			qrGeneratedAt: null,
			phoneNumber: null,
			pushName: null,
			lastError: null,
		});
	}

	/**
	 * Re-read the group catalog. Never flips `tracked` — discovering a group must
	 * not start persisting its messages.
	 */
	async refreshChannels(): Promise<number> {
		const client = this.requireClient();
		const chats = await client.getChats();
		const groups = chats
			.filter((c) => c.isGroup)
			.map((c) => {
				const group = c as typeof c & { participants?: unknown[] };
				return {
					id: c.id._serialized,
					name: c.name,
					participantCount: Array.isArray(group.participants) ? group.participants.length : 0,
				};
			});

		await upsertChannels(this.db, groups);
		log.info(`catalog refreshed: ${groups.length} groups`);
		return groups.length;
	}

	async backfillTracked(reason: string): Promise<void> {
		const client = this.requireClient();
		const { listChannels } = await import("@crafter/db");
		const tracked = await listChannels(this.db, { trackedOnly: true });

		for (const channel of tracked) {
			try {
				const n = await backfillChannel(this.db, client, channel.id);
				if (n > 0) log.info(`backfill (${reason}) ${channel.name}: +${n} messages`);
			} catch (e) {
				log.error(
					`backfill failed for ${channel.name}: ${e instanceof Error ? e.message : String(e)}`,
				);
			}
		}
	}

	/**
	 * Written on every tick regardless of WhatsApp state. Combined with `status`,
	 * this separates "the worker is down" from "the worker is up but unpaired" —
	 * two problems with very different fixes.
	 */
	async heartbeat(): Promise<void> {
		await updateSession(this.db, { heartbeatAt: new Date() });
	}

	requireClient(): WhatsAppClient {
		if (!this.client) {
			throw new Error("WhatsApp is not connected. Pair the account from the dashboard first.");
		}
		return this.client;
	}
}

/**
 * True only when a *paired* session exists. Puppeteer creates the profile directory
 * on first launch even without auth, so the directory alone gives false positives —
 * WhatsApp Web's auth state lives in the IndexedDB folder for web.whatsapp.com.
 */
export function sessionExists(): boolean {
	const idbDir = join(
		env.sessionDir,
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
