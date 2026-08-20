import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Command } from "commander";
import { VERSION } from "../constants.ts";
import { connect } from "../lib/client.ts";

/**
 * stdio bridge to the hosted MCP endpoint.
 *
 * Clients that speak remote MCP should point straight at `<url>/mcp` and use OAuth.
 * This exists for the ones that only support stdio servers, or where pasting a
 * token into a local config is simpler than an OAuth round trip.
 *
 * Nothing may be written to stdout here except protocol frames — diagnostics go to
 * stderr, or they corrupt the stream.
 */
export function registerMcp(program: Command) {
	program
		.command("mcp")
		.description("Run a local stdio MCP server that proxies to the hosted one")
		.action(async () => {
			const remote = await connect();

			const server = new Server(
				{ name: "crafter-status", version: VERSION },
				{ capabilities: { tools: {} } },
			);

			server.setRequestHandler(ListToolsRequestSchema, async () => {
				return remote.client.listTools();
			});

			server.setRequestHandler(CallToolRequestSchema, async (request) => {
				return remote.client.callTool(request.params);
			});

			const shutdown = async () => {
				await server.close().catch(() => {});
				await remote.close().catch(() => {});
				process.exit(0);
			};
			process.on("SIGINT", () => void shutdown());
			process.on("SIGTERM", () => void shutdown());

			await server.connect(new StdioServerTransport());
			process.stderr.write("crafter mcp: bridged to hosted server\n");
		});
}
