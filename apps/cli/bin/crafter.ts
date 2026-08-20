#!/usr/bin/env bun
import { Command } from "commander";
import { detectMode } from "../src/cli/detect.ts";
import { mapError } from "../src/cli/error-map.ts";
import { getGlobalFlagDefs, parseGlobalFlags } from "../src/cli/global-flags.ts";
import { CLI_NAME, VERSION } from "../src/constants.ts";
import { registerAsk } from "../src/commands/ask.ts";
import { registerConfig } from "../src/commands/config.ts";
import { registerGroups } from "../src/commands/groups.ts";
import { registerLogin } from "../src/commands/login.ts";
import { registerLogout } from "../src/commands/logout.ts";
import { registerStatus } from "../src/commands/status.ts";

const program = new Command();

program
	.name(CLI_NAME)
	.description("CLI to get status from your WhatsApp groups via an LLM")
	.version(VERSION);

for (const def of getGlobalFlagDefs()) {
	program.option(def.flag, def.description);
}

registerConfig(program);
registerStatus(program);
registerLogin(program);
registerLogout(program);
registerGroups(program);
registerAsk(program);

program.action(() => {
	program.help();
});

try {
	await program.parseAsync(process.argv);
} catch (error) {
	const mapped = mapError(error);
	const flags = parseGlobalFlags(program.opts());
	const mode = detectMode(flags);

	if (mode === "json") {
		process.stderr.write(`${JSON.stringify(mapped.toJSON())}\n`);
	} else {
		process.stderr.write(`\x1b[31m✗\x1b[0m ${mapped.human}\n`);
		if (mapped.hint) process.stderr.write(`  ${mapped.hint}\n`);
	}
	process.exit(mapped.exitCode);
}
