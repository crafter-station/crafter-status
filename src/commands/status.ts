import type { Command } from "commander";
import { configExists, loadConfig, redactApiKey } from "../cli/config.ts";
import { parseGlobalFlags } from "../cli/global-flags.ts";
import { sessionExists } from "../lib/whatsapp.ts";
import { emit } from "./emit.ts";
import * as ui from "./render.ts";

export function registerStatus(program: Command): void {
	program
		.command("status")
		.description("Show CLI readiness: config + WhatsApp session")
		.action(function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());

			const hasConfig = configExists();
			const hasSession = sessionExists();
			const config = hasConfig ? loadConfig() : null;

			const result = {
				ok: hasConfig && hasSession,
				config: hasConfig,
				session: hasSession,
				openaiApiKey: config ? redactApiKey(config.openaiApiKey) : null,
				model: config?.model ?? null,
			};

			emit(result, flags, (r) => {
				ui.header("Crafter Status");
				ui.kv("Config", r.config ? "set" : "missing — run `crafter config set`");
				ui.kv("WhatsApp", r.session ? "paired" : "not paired — run `crafter login`");
				ui.kv("OpenAI Key", r.openaiApiKey ?? "—");
				ui.kv("Model", r.model ?? "—");
				process.stdout.write("\n");
			});
		});
}
