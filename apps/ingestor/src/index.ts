import { createDatabase, getSession, updateSession } from "@crafter/db";
import { env } from "./env.ts";
import { log } from "./log.ts";
import { Scheduler } from "./scheduler.ts";
import { startControlServer } from "./server.ts";
import { sessionExists, WhatsAppRunner } from "./whatsapp.ts";

const db = createDatabase(env.databaseUrl, { max: 4 });
const whatsapp = new WhatsAppRunner(db);
const scheduler = new Scheduler(db, whatsapp);

const server = startControlServer(db, whatsapp);
scheduler.start();

// Only auto-connect when a paired session is already on disk. Booting the client
// without one would burn a QR nobody is watching, and the QR expires.
if (sessionExists()) {
	log.info("existing session found — connecting");
	whatsapp
		.start()
		.catch((e) =>
			log.error(`startup connect failed: ${e instanceof Error ? e.message : String(e)}`),
		);
} else {
	log.info("no paired session — waiting for a pair request from the dashboard");
	const session = await getSession(db);
	if (session.status !== "disconnected") {
		await updateSession(db, { status: "disconnected", qr: null });
	}
}

/**
 * A long-running worker must not die from one bad call into a browser it does not
 * control. whatsapp-web.js emits from async listeners all over, and a single
 * escaping rejection would otherwise exit the process and take the control API and
 * the scheduler with it — turning a transient WhatsApp hiccup into a crash loop.
 */
process.on("unhandledRejection", (reason) => {
	log.error(
		`unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
	);
});

process.on("uncaughtException", (error) => {
	log.error(`uncaught exception: ${error.stack ?? error.message}`);
});

async function shutdown(signal: string) {
	log.info(`${signal} received — shutting down`);
	scheduler.stop();
	server.stop();
	try {
		await updateSession(db, { heartbeatAt: null });
		await whatsapp.stop();
	} finally {
		process.exit(0);
	}
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
