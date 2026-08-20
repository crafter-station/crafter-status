import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "@crafter/db";
import { updateSession, upsertChannels } from "@crafter/db";
import wwebjs from "whatsapp-web.js";
import { withDeadline } from "./deadline.ts";
import { env } from "./env.ts";
import { backfillChannel, ingestMessage } from "./ingest.ts";
import { log } from "./log.ts";

const { Client, LocalAuth } = wwebjs;

/** Reading 500+ chats is not instant, but it is not minutes either. */
const CATALOG_TIMEOUT_MS = 60_000;

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

		clearStaleProfileLocks();
		await updateSession(this.db, { status: "connecting", lastError: null });

		if (env.waWebVersion) log.info(`pinning WhatsApp Web ${env.waWebVersion}`);

		const client = new Client({
			authStrategy: new LocalAuth({ clientId: "crafter", dataPath: env.sessionDir }),
			...(env.waWebVersion
				? {
						webVersionCache: {
							type: "remote" as const,
							remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${env.waWebVersion}.html`,
						},
					}
				: {}),
			puppeteer: {
				headless: env.headless,
				args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
				// Default is 180s. A worker that must stay responsive cannot wait three
				// minutes to learn a single page call is not coming back.
				protocolTimeout: 75_000,
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

		// Everything in here is guarded: this is an async listener, so an escaping
		// rejection is unhandled and takes the whole process down. A failure to read
		// the chat list must not cost us the connection we just established.
		client.on("ready", async () => {
			try {
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
			} catch (e) {
				log.error(`ready bookkeeping failed: ${e instanceof Error ? e.message : String(e)}`);
			}

			// Catalogue and backfill are independent, and are guarded separately.
			// Chaining them meant a stalled chat-list read silently prevented every
			// tracked channel from ever being backfilled.
			try {
				await this.refreshChannelsWithRetry();
			} catch (e) {
				log.error(`catalog refresh failed: ${e instanceof Error ? e.message : String(e)}`);
			}

			try {
				// Heal whatever we missed while disconnected. Upserts keyed on WhatsApp's
				// own message id make an overlapping replay free.
				await this.backfillTracked("reconnect");
			} catch (e) {
				log.error(`backfill failed: ${e instanceof Error ? e.message : String(e)}`);
			}
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
		const client = this.requireClient() as unknown as {
			pupPage: { evaluate: <T>(fn: () => T) => Promise<T> };
		};

		// Deliberately not client.getChats(). That builds a full model for every chat
		// with Promise.all, so a single unreadable chat rejects the whole call — on
		// this account 25 of 544 chats throw
		//   DataError: Failed to execute 'get' on 'IDBObjectStore'
		// from WhatsApp's own IndexedDB layer, and the other 188 groups became
		// invisible because of them. Which chats are damaged depends on the profile,
		// which is why the same code lists groups fine on another machine.
		//
		// The catalogue needs three fields, all present on the model itself, so this
		// reads them directly and skips whatever it cannot parse.
		const groups = await withDeadline(
			client.pupPage.evaluate(() => {
				const win = (globalThis as unknown as { window: Record<string, any> }).window;
				const chats: any[] = win.require("WAWebCollections").Chat.getModelsArray();
				const out: { id: string; name: string; participantCount: number }[] = [];

				for (const chat of chats) {
					try {
						if (chat?.id?.server !== "g.us") continue;
						const id: string | undefined = chat.id._serialized;
						if (!id) continue;

						out.push({
							id,
							name: chat.name ?? chat.formattedTitle ?? chat.contact?.name ?? id,
							participantCount: chat.groupMetadata?.participants?.length ?? 0,
						});
					} catch {
						// One unreadable chat must not cost us the rest of the catalogue.
					}
				}

				return out;
			}),
			CATALOG_TIMEOUT_MS,
			"reading the chat list from WhatsApp",
		);

		await upsertChannels(this.db, groups);
		log.info(`catalog refreshed: ${groups.length} groups`);
		return groups.length;
	}

	/**
	 * Right after a first pairing WhatsApp Web has not finished syncing the chat
	 * list, so `getChats()` legitimately returns nothing — or throws while the store
	 * is still being populated. Retrying turns "you must press Refresh yourself,
	 * and guess when" into something that just works.
	 */
	private async refreshChannelsWithRetry(attempts = 3, delayMs = 10_000): Promise<number> {
		for (let attempt = 1; attempt <= attempts; attempt++) {
			try {
				const count = await this.refreshChannels();
				if (count > 0) return count;
				log.info(`catalog empty (attempt ${attempt}/${attempts}) — chat list still syncing`);
			} catch (e) {
				log.warn(
					`catalog refresh failed (attempt ${attempt}/${attempts}): ${e instanceof Error ? e.message : String(e)}`,
				);
			}

			if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
		return 0;
	}

	/**
	 * Outcomes are written to the audit log, not just to stdout. Container logs on
	 * this platform are not reachable from anywhere the rest of the system can see,
	 * and a backfill that quietly stores nothing is indistinguishable from a channel
	 * with no history — which has now cost two round trips to diagnose.
	 */
	async backfillTracked(reason: string): Promise<void> {
		const client = this.requireClient();
		const { listChannels, recordAudit } = await import("@crafter/db");
		const tracked = await listChannels(this.db, { trackedOnly: true });

		for (const channel of tracked) {
			// Written before the work, not after: without it a backfill that never
			// returns is indistinguishable from one that never started.
			await recordAudit(this.db, {
				actorLabel: "ingestor",
				action: "channel.backfill_started",
				targetType: "channel",
				targetId: channel.id,
				metadata: { reason },
			}).catch(() => {});

			try {
				const result = await backfillChannel(this.db, client, channel.id);
				log.info(
					`backfill (${reason}) ${channel.name}: fetched ${result.fetched}, in window ${result.withinWindow}, inserted ${result.inserted}`,
				);
				await recordAudit(this.db, {
					actorLabel: "ingestor",
					action: "channel.backfill",
					targetType: "channel",
					targetId: channel.id,
					metadata: { reason, ...result },
				});
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				const stack = e instanceof Error ? (e.stack ?? "") : "";
				log.error(`backfill failed for ${channel.name}: ${message}`);
				await recordAudit(this.db, {
					actorLabel: "ingestor",
					action: "channel.backfill_failed",
					targetType: "channel",
					targetId: channel.id,
					metadata: { reason, error: message, stack: stack.slice(0, 1500) },
				}).catch(() => {});
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
 * Chromium refuses to launch when the profile carries a lock naming another host:
 *
 *   The profile appears to be in use by another Chromium process (35) on another
 *   computer (41d3a7ddd2a2).
 *
 * A container restart looks exactly like that — the profile lives on a persistent
 * volume, so the lock from the previous container survives while its hostname and
 * PID do not. The paired session itself is intact; only the lock is stale.
 *
 * Safe because exactly one replica of this worker ever runs, and it launches one
 * browser. Any lock present before we start belongs to a process that no longer
 * exists. These are symlinks, so `existsSync` is useless here (it follows the link
 * and reports false for a dangling one) — `rmSync` with `force` handles all cases.
 */
function clearStaleProfileLocks(): void {
	const profile = join(env.sessionDir, "session-crafter");

	for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
		try {
			rmSync(join(profile, name), { force: true, recursive: true });
		} catch (e) {
			log.warn(`could not clear ${name}: ${e instanceof Error ? e.message : String(e)}`);
		}
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
