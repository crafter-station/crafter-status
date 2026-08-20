import type { Database } from "@crafter/db";
import { getSession, getSettings, localToday } from "@crafter/db";
import { env } from "./env.ts";
import { backfillChannel } from "./ingest.ts";
import { log } from "./log.ts";
import { generateSummary } from "./summaries.ts";
import type { WhatsAppRunner } from "./whatsapp.ts";

/**
 * Internal control plane. Only the web app talks to this, authenticated with a
 * shared secret — it is never exposed publicly. Read paths (status, summaries)
 * deliberately live in the web app talking to Postgres directly; this API is only
 * for the things that require the live WhatsApp client.
 */
export function startControlServer(db: Database, whatsapp: WhatsAppRunner) {
	const server = Bun.serve({
		port: env.port,
		idleTimeout: 120,
		fetch: async (req) => {
			const url = new URL(req.url);

			if (url.pathname === "/health") {
				return json({ ok: true, connected: whatsapp.isReady });
			}

			if (!authorized(req)) {
				return json({ error: "unauthorized" }, 401);
			}

			try {
				return await route(db, whatsapp, req, url);
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				const stack = e instanceof Error ? e.stack : undefined;
				log.error(`control ${url.pathname}: ${message}
${stack ?? ""}`);
				// The stack matters here: whatsapp-web.js surfaces failures from minified
				// page code as single-letter messages, which identify nothing on their own.
				return json({ error: message, stack }, 500);
			}
		},
	});

	log.info(`control API listening on :${server.port}`);
	return server;
}

function authorized(req: Request): boolean {
	const header = req.headers.get("authorization") ?? "";
	const token = header.startsWith("Bearer ") ? header.slice(7) : "";
	// Length-independent comparison is overkill for a private network secret, but
	// the token is a plain string equality check on a public-ish port either way.
	return token.length > 0 && token === env.ingestorToken;
}

async function route(
	db: Database,
	whatsapp: WhatsAppRunner,
	req: Request,
	url: URL,
): Promise<Response> {
	const { pathname } = url;

	if (pathname === "/status" && req.method === "GET") {
		const session = await getSession(db);
		return json({ session, workerConnected: whatsapp.isReady });
	}

	// Fixed probe into the page, to locate a failure that only ever surfaces as a
	// minified identifier. getChats() is require -> getModelsArray -> getChatModel
	// per chat, and a bare "r" says nothing about which of the three threw.
	if (pathname === "/diagnostics" && req.method === "GET") {
		const client = whatsapp.requireClient() as unknown as {
			pupPage: { evaluate: (fn: () => unknown) => Promise<unknown> };
		};
		const probe = await client.pupPage.evaluate(async () => {
			// This function is serialized and run inside the browser page, where
			// `window` exists; the worker itself has no DOM types.
			const win = (globalThis as unknown as { window: Record<string, any> }).window;
			const out: Record<string, unknown> = {};
			const describe = (e: any) =>
				`${e?.constructor?.name ?? "?"}: ${e?.message ?? String(e)} :: ${String(e?.stack ?? "").slice(0, 200)}`;

			out.hasRequire = typeof win.require === "function";
			out.hasWWebJS = typeof win.WWebJS === "object";
			out.hasStore = typeof win.Store === "object";

			let chats: any[] | null = null;
			try {
				const collections = win.require("WAWebCollections");
				out.collectionKeys = Object.keys(collections).slice(0, 25);
				chats = collections.Chat.getModelsArray();
				out.chatCount = chats?.length ?? null;
				out.groupCount = chats?.filter((c: any) => c?.id?.server === "g.us").length ?? null;
			} catch (e) {
				out.collectionsError = describe(e);
			}

			if (chats?.length) {
				try {
					await win.WWebJS.getChatModel(chats[0]);
					out.firstChatModel = "ok";
				} catch (e) {
					out.firstChatModelError = describe(e);
				}

				let failures = 0;
				let sample = "";
				for (const chat of chats) {
					try {
						await win.WWebJS.getChatModel(chat);
					} catch (e) {
						failures++;
						if (!sample) sample = `${chat?.id?._serialized ?? "?"} -> ${describe(e)}`;
					}
				}
				out.modelFailures = failures;
				out.modelFailureSample = sample;
			}

			return out;
		});
		return json(probe);
	}

	if (pathname === "/pair" && req.method === "POST") {
		// Fire and forget: initialize() resolves only once WhatsApp is ready, which
		// is after the user scans. The dashboard polls the session row for the QR.
		void whatsapp
			.start()
			.catch((e) => log.error(`pair failed: ${e instanceof Error ? e.message : String(e)}`));
		return json({ ok: true, status: "connecting" });
	}

	if (pathname === "/logout" && req.method === "POST") {
		await whatsapp.logout();
		return json({ ok: true });
	}

	if (pathname === "/channels/refresh" && req.method === "POST") {
		const count = await whatsapp.refreshChannels();
		return json({ ok: true, count });
	}

	const backfill = pathname.match(/^\/channels\/([^/]+)\/backfill$/);
	if (backfill?.[1] && req.method === "POST") {
		const channelId = decodeURIComponent(backfill[1]);
		const result = await backfillChannel(db, whatsapp.requireClient(), channelId);
		return json({ ok: true, ...result });
	}

	if (pathname === "/summaries/regenerate" && req.method === "POST") {
		const body = (await req.json()) as { channelId?: string; day?: string };
		if (!body.channelId) return json({ error: "channelId is required" }, 400);

		const settings = await getSettings(db);
		const day = body.day ?? localToday(settings.timezone);
		const today = localToday(settings.timezone);

		const summary = await generateSummary(db, {
			channelId: body.channelId,
			day,
			// Regenerating a past day re-freezes it; today stays live.
			freeze: day < today,
			trigger: "manual",
		});
		return json({ ok: true, summary });
	}

	return json({ error: "not found" }, 404);
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}
