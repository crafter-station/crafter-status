import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig } from "../cli/config.ts";
import { AppError } from "../cli/error-map.ts";
import { USER_AGENT, VERSION } from "../constants.ts";
import type { Config } from "../types.ts";

export type Connection = {
	client: Client;
	close: () => Promise<void>;
};

/**
 * The CLI is just an MCP client. Rather than maintaining a second REST surface,
 * every command calls the same tools an agent would — which means the two can
 * never drift apart.
 */
export async function connect(config: Config = loadConfig()): Promise<Connection> {
	const transport = new StreamableHTTPClientTransport(new URL(`${config.apiUrl}/mcp`), {
		requestInit: {
			headers: {
				authorization: `Bearer ${config.token}`,
				"user-agent": USER_AGENT,
			},
		},
	});

	const client = new Client({ name: "crafter-cli", version: VERSION });

	try {
		await client.connect(transport);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		if (message.includes("401") || message.includes("Unauthorized")) {
			throw new AppError("UNAUTHORIZED", {
				human: "The server rejected your token.",
				hint: "Mint a fresh one in Settings → MCP endpoint, then run `crafter login`.",
				exitCode: 4,
			});
		}
		throw new AppError("UNREACHABLE", {
			human: `Could not reach ${config.apiUrl}: ${message}`,
			hint: "Check the URL with `crafter config show`.",
			exitCode: 7,
		});
	}

	return { client, close: () => client.close() };
}

/** Call a tool and parse its JSON text payload. */
export async function callTool<T = unknown>(
	client: Client,
	name: string,
	args: Record<string, unknown> = {},
): Promise<T> {
	const result = await client.callTool({ name, arguments: args });

	const content = (result.content ?? []) as { type: string; text?: string }[];
	const first = content.find((c) => c.type === "text");
	if (!first?.text) {
		throw new Error(`Tool ${name} returned no text content.`);
	}

	if (result.isError) {
		throw new Error(first.text);
	}

	try {
		return JSON.parse(first.text) as T;
	} catch {
		return first.text as unknown as T;
	}
}

/** One-shot helper: connect, call, disconnect. */
export async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
	const conn = await connect();
	try {
		return await fn(conn.client);
	} finally {
		await conn.close().catch(() => {});
	}
}
