import * as p from "@clack/prompts";
import type { Command } from "commander";
import pc from "picocolors";
import { loadConfig, redactToken, resetConfig, saveConfig } from "../cli/config.ts";
import { parseGlobalFlags } from "../cli/global-flags.ts";
import { DEFAULT_API_URL } from "../constants.ts";
import { callTool, connect, withClient } from "../lib/client.ts";
import { emit } from "./emit.ts";
import { header, info, kv, success, table } from "./render.ts";

type ChannelList = {
	timezone: string;
	today: string;
	session_status: { live: boolean; state: string; last_heartbeat: string | null; note: string };
	channels: { id: string; name: string; members: number; last_message_at: string | null }[];
};

type Summary = {
	channel: string;
	day: string;
	summary?: null;
	note?: string;
	frozen?: boolean;
	message_count?: number;
	tldr?: string;
	decisions?: string[];
	action_items?: { text: string; owner: string | null; due: string | null }[];
	open_questions?: string[];
	participants?: string[];
};

export function registerLogin(program: Command) {
	program
		.command("login")
		.description("Sign in with a personal token from the dashboard")
		.option("--url <url>", "Deployment URL", DEFAULT_API_URL)
		.option("--token <token>", "Personal token (crft_…); prompts if omitted")
		.action(async (opts: { url: string; token?: string }) => {
			const apiUrl = String(opts.url).replace(/\/$/, "");

			let token = opts.token;
			if (!token) {
				info(`Mint a token at ${apiUrl}/settings → MCP endpoint.`);
				const answer = await p.password({
					message: "Paste your token",
					validate: (v) => (v?.startsWith("crft_") ? undefined : "Tokens start with crft_"),
				});
				if (p.isCancel(answer)) {
					info("Cancelled.");
					return;
				}
				token = answer;
			}

			// Verify before writing, so a bad paste fails now rather than on first use.
			const conn = await connect({ apiUrl, token });
			const channels = await callTool<ChannelList>(conn.client, "list_channels");
			await conn.close();

			saveConfig({ apiUrl, token });
			success(`Signed in to ${apiUrl} — ${channels.channels.length} channels visible.`);
		});
}

export function registerLogout(program: Command) {
	program
		.command("logout")
		.description("Forget the stored token")
		.action(() => {
			resetConfig();
			success("Signed out.");
		});
}

export function registerConfig(program: Command) {
	const config = program.command("config").description("Manage CLI configuration");

	config
		.command("show")
		.description("Show current config (token redacted)")
		.action(() => {
			const flags = parseGlobalFlags(program.opts());
			const cfg = loadConfig();
			emit({ apiUrl: cfg.apiUrl, token: redactToken(cfg.token) }, flags, (v) => {
				header("Config");
				kv("API URL", v.apiUrl);
				kv("Token", v.token);
			});
		});

	config
		.command("reset")
		.description("Delete the stored config")
		.action(() => {
			resetConfig();
			success("Config deleted.");
		});
}

export function registerStatus(program: Command) {
	program
		.command("status")
		.description("Show workspace and WhatsApp mirror status")
		.action(async () => {
			const flags = parseGlobalFlags(program.opts());
			const data = await withClient((c) => callTool<ChannelList>(c, "list_channels"));

			emit(data, flags, (v) => {
				header("Crafter Status");
				kv("Timezone", v.timezone);
				kv("Today", v.today);
				kv("Mirror", v.session_status.live ? pc.green("live") : pc.red(v.session_status.state));
				kv("Last heartbeat", v.session_status.last_heartbeat ?? "—");
				kv("Channels", v.channels.length);
				if (!v.session_status.live) {
					process.stdout.write(`\n  ${pc.yellow(v.session_status.note)}\n`);
				}
			});
		});
}

export function registerChannels(program: Command) {
	const channels = program
		.command("channels")
		.alias("groups")
		.description("Work with tracked channels");

	channels
		.command("list", { isDefault: true })
		.description("List tracked channels")
		.action(async () => {
			const flags = parseGlobalFlags(program.opts());
			const data = await withClient((c) => callTool<ChannelList>(c, "list_channels"));

			emit(data.channels, flags, (rows) => {
				header("Channels");
				table(
					rows.map((r) => ({
						name: r.name,
						members: r.members,
						last: r.last_message_at ? r.last_message_at.slice(0, 16).replace("T", " ") : "—",
						id: r.id,
					})),
					[
						{ key: "name", label: "NAME", width: 28 },
						{ key: "members", label: "MEMBERS", width: 8 },
						{ key: "last", label: "LAST MESSAGE", width: 17 },
						{ key: "id", label: "ID", width: 24 },
					],
				);
			});
		});
}

export function registerSummary(program: Command) {
	program
		.command("summary <channel>")
		.description("Show a channel's summary for a day (matches on name or id)")
		.option("--day <YYYY-MM-DD>", "Defaults to today")
		.action(async (channel: string, opts: { day?: string }) => {
			const flags = parseGlobalFlags(program.opts());

			const data = await withClient(async (client) => {
				const list = await callTool<ChannelList>(client, "list_channels");
				const match =
					list.channels.find((c) => c.id === channel) ??
					list.channels.find((c) => c.name.toLowerCase().includes(channel.toLowerCase()));

				if (!match) {
					const names = list.channels.map((c) => c.name).join(", ");
					throw new Error(`No channel matching "${channel}". Available: ${names || "(none)"}`);
				}

				return callTool<Summary>(client, "get_daily_summary", {
					channel_id: match.id,
					...(opts.day ? { date: opts.day } : {}),
				});
			});

			emit(data, flags, (v) => {
				header(`${v.channel} — ${v.day}`);
				if (!v.tldr) {
					info(v.note ?? "No summary stored for this day.");
					return;
				}
				process.stdout.write(`\n  ${v.tldr}\n`);
				printList("Decisions", v.decisions);
				if (v.action_items?.length) {
					process.stdout.write(`\n  ${pc.bold("Action items")}\n`);
					for (const a of v.action_items) {
						const owner = a.owner ? `${pc.bold(a.owner)} — ` : "";
						const due = a.due ? pc.dim(` (${a.due})`) : "";
						process.stdout.write(`    • ${owner}${a.text}${due}\n`);
					}
				}
				printList("Open questions", v.open_questions);
				process.stdout.write(
					`\n  ${pc.dim(`${v.message_count ?? 0} messages${v.frozen ? " · frozen" : ""}`)}\n`,
				);
			});
		});
}

export function registerAsk(program: Command) {
	program
		.command("ask <question...>")
		.description("Ask a question across the tracked channels")
		.option("--channel <name>", "Restrict to one channel")
		.action(async (parts: string[], opts: { channel?: string }) => {
			const flags = parseGlobalFlags(program.opts());
			const question = parts.join(" ");

			const data = await withClient(async (client) => {
				let channelId: string | undefined;
				if (opts.channel) {
					const list = await callTool<ChannelList>(client, "list_channels");
					const match = list.channels.find((c) =>
						c.name.toLowerCase().includes(opts.channel?.toLowerCase() ?? ""),
					);
					if (!match) throw new Error(`No channel matching "${opts.channel}".`);
					channelId = match.id;
				}

				return callTool<{ answer: string; model: string; tool_calls: unknown[] }>(client, "ask", {
					question,
					...(channelId ? { channel_id: channelId } : {}),
				});
			});

			emit(data, flags, (v) => {
				process.stdout.write(`\n${v.answer}\n`);
				process.stdout.write(`\n${pc.dim(`${v.model} · ${v.tool_calls.length} tool calls`)}\n`);
			});
		});
}

function printList(label: string, items?: string[]) {
	if (!items?.length) return;
	process.stdout.write(`\n  ${pc.bold(label)}\n`);
	for (const item of items) process.stdout.write(`    • ${item}\n`);
}
