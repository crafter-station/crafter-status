import type { Command } from "commander";
import { AppError } from "../cli/error-map.ts";
import { parseGlobalFlags } from "../cli/global-flags.ts";
import { loadGroupsCache, saveGroupsCache } from "../lib/cache.ts";
import { askAgent } from "../lib/openai.ts";
import { initWhatsApp, listGroups } from "../lib/whatsapp.ts";
import type { GroupSummary } from "../types.ts";
import { emit } from "./emit.ts";
import * as ui from "./render.ts";

export function registerAsk(program: Command): void {
	program
		.command("ask <question...>")
		.description(
			"Ask a question. The agent picks which group(s) to inspect via tool calls.",
		)
		.option("--refresh", "Refresh the groups cache before answering")
		.action(async function (this: Command, questionParts: string[]) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const opts = this.opts();
			const question = questionParts.join(" ").trim();
			const refresh = opts.refresh === true;

			if (!question) {
				throw new AppError("MISSING_QUESTION", { human: "Please provide a question." });
			}

			ui.info("Connecting to WhatsApp… (this can take 10-30s on cold start)");
			const handle = await initWhatsApp({ verbose: flags.verbose });

			let result;
			try {
				let groups: GroupSummary[];
				const cached = refresh ? null : loadGroupsCache();
				if (cached) {
					groups = cached.groups;
					ui.info(`Using cached groups list (${groups.length} groups).`);
				} else {
					ui.info("Fetching groups list…");
					groups = await listGroups(handle.client);
					saveGroupsCache(groups);
				}

				if (groups.length === 0) {
					throw new AppError("NO_GROUPS", {
						human: "This account is not in any WhatsApp groups.",
					});
				}

				ui.info("Asking the agent…");
				result = await askAgent(question, groups, handle.client, (event) => {
					if (event.type === "tool_call") {
						const argSummary = Object.entries(event.args)
							.map(([k, v]) => `${k}=${v}`)
							.join(", ");
						ui.info(`  → ${event.name}(${argSummary})`);
					}
				});
			} finally {
				await handle.close();
			}

			emit(result, flags, (r) => {
				ui.header("Answer");
				process.stdout.write(`${r.answer}\n\n`);
				ui.kv("Iterations", r.iterations);
				ui.kv("Tool calls", r.toolCalls.length);
				ui.kv("Model", r.model);
				process.stdout.write("\n");
			});
		});
}
