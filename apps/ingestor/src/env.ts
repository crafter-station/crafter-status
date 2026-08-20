import { loadRootEnv } from "@crafter/core/load-env";

loadRootEnv();

function required(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set. See .env.example at the repo root.`);
	return value;
}

export const env = {
	databaseUrl: required("DATABASE_URL"),
	openaiApiKey: required("OPENAI_API_KEY"),
	/** Shared secret the web app presents on the internal control API. */
	ingestorToken: required("INGESTOR_TOKEN"),
	port: Number(process.env.INGESTOR_PORT ?? 8787),
	/** Chromium profile + WhatsApp auth state. Must be a persistent volume in prod. */
	sessionDir: process.env.SESSION_DIR ?? ".wwebjs_auth",
	headless: process.env.HEADLESS !== "false",
	/**
	 * Pin the WhatsApp Web build the library injects against, e.g.
	 * "2.3000.1045649367-alpha". WhatsApp ships new builds continuously and a
	 * mismatch makes whatsapp-web.js throw from inside minified page code — errors
	 * like a bare "r", which say nothing. Left unset, the live build is used.
	 * Kept in the environment so a broken build can be worked around by restarting
	 * with a different value, without a rebuild.
	 */
	waWebVersion: process.env.WA_WEB_VERSION ?? "",
};
