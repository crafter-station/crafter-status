import "server-only";

const BASE_URL = process.env.INGESTOR_URL ?? "http://localhost:8787";
const TOKEN = process.env.INGESTOR_TOKEN ?? "";

export class IngestorUnreachableError extends Error {
	constructor(cause: unknown) {
		super("The WhatsApp worker is not reachable. It may be restarting or down.");
		this.name = "IngestorUnreachableError";
		this.cause = cause;
	}
}

/**
 * Client for the ingestor's private control API. Only operations that need the live
 * WhatsApp client go through here — everything readable comes from Postgres, so the
 * dashboard still renders when the worker is down.
 */
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
	let response: Response;
	try {
		response = await fetch(`${BASE_URL}${path}`, {
			...init,
			headers: {
				...init.headers,
				authorization: `Bearer ${TOKEN}`,
				"content-type": "application/json",
			},
			cache: "no-store",
		});
	} catch (e) {
		throw new IngestorUnreachableError(e);
	}

	const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
	if (!response.ok) {
		throw new Error(body.error ?? `Ingestor returned ${response.status}`);
	}
	return body;
}

export const ingestor = {
	health: () => call<{ ok: boolean; connected: boolean }>("/health"),
	pair: () => call<{ ok: boolean }>("/pair", { method: "POST" }),
	logout: () => call<{ ok: boolean }>("/logout", { method: "POST" }),
	refreshChannels: () =>
		call<{ ok: boolean; count: number }>("/channels/refresh", { method: "POST" }),
	backfill: (channelId: string) =>
		call<{ ok: boolean; fetched: number; parsed: number; withinWindow: number; inserted: number }>(
			`/channels/${encodeURIComponent(channelId)}/backfill`,
			{
				method: "POST",
			},
		),
	regenerate: (channelId: string, day?: string) =>
		call<{ ok: boolean }>("/summaries/regenerate", {
			method: "POST",
			body: JSON.stringify({ channelId, day }),
		}),
};
