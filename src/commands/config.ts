import { password, text } from "@clack/prompts";
import type { Command } from "commander";
import {
	configExists,
	loadConfig,
	redactApiKey,
	resetConfig,
	saveConfig,
} from "../cli/config.ts";
import { parseGlobalFlags } from "../cli/global-flags.ts";
import { CONFIG_FILE, DEFAULT_MODEL } from "../constants.ts";
import { emit } from "./emit.ts";
import * as ui from "./render.ts";

export function registerConfig(program: Command): void {
	const cmd = program.command("config").description("Manage CLI configuration");

	cmd
		.command("set")
		.description("Set OpenAI API key and model")
		.option("--api-key <key>", "OpenAI API key")
		.option("--model <name>", `OpenAI model (default: ${DEFAULT_MODEL})`)
		.action(async function (this: Command) {
			const opts = this.optsWithGlobals();
			let apiKey = opts.apiKey as string | undefined;
			let model = (opts.model as string | undefined) ?? DEFAULT_MODEL;

			if (!apiKey) {
				const result = await password({
					message: "OpenAI API key (sk-...)",
					validate: (v) => {
						if (!v || !v.startsWith("sk-"))
							return "Expected an OpenAI key starting with `sk-`.";
					},
				});
				if (typeof result !== "string") process.exit(130);
				apiKey = result;
			}

			if (!opts.model) {
				const result = await text({
					message: `Model (press enter for ${DEFAULT_MODEL})`,
					placeholder: DEFAULT_MODEL,
				});
				if (typeof result === "string" && result.trim()) {
					model = result.trim();
				}
			}

			saveConfig({ openaiApiKey: apiKey, model });
			ui.success(`Config saved to ${CONFIG_FILE}`);
		});

	cmd
		.command("show")
		.description("Show current configuration")
		.action(function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());

			if (!configExists()) {
				ui.warn("No config found. Run `crafter config set` first.");
				process.exit(1);
			}

			const config = loadConfig();
			const display = {
				openaiApiKey: redactApiKey(config.openaiApiKey),
				model: config.model,
				configPath: CONFIG_FILE,
			};

			emit(display, flags, () => {
				ui.header("Crafter Config");
				ui.kv("OpenAI Key", display.openaiApiKey);
				ui.kv("Model", display.model);
				ui.kv("Config Path", display.configPath);
				process.stdout.write("\n");
			});
		});

	cmd
		.command("reset")
		.description("Remove stored configuration")
		.action(function () {
			resetConfig();
			ui.success("Config removed.");
		});
}
