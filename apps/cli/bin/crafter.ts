#!/usr/bin/env bun
import { Command } from "commander";
import { detectMode } from "../src/cli/detect.ts";
import { mapError } from "../src/cli/error-map.ts";
import { getGlobalFlagDefs, parseGlobalFlags } from "../src/cli/global-flags.ts";
import {
	registerAsk,
	registerChannels,
	registerConfig,
	registerLogin,
	registerLogout,
	registerStatus,
	registerSummary,
} from "../src/commands/core.ts";
import { registerMcp } from "../src/commands/mcp.ts";
import { CLI_NAME, VERSION } from "../src/constants.ts";

const program = new Command();

program
	.name(CLI_NAME)
	.description("Daily status from your team's WhatsApp groups")
	.version(VERSION);

for (const def of getGlobalFlagDefs()) {
	program.option(def.flag, def.description);
}

registerLogin(program);
registerLogout(program);
registerConfig(program);
registerStatus(program);
registerChannels(program);
registerSummary(program);
registerAsk(program);
registerMcp(program);

program.action(() => program.help());

try {
	await program.parseAsync(process.argv);
} catch (error) {
	const mapped = mapError(error);
	const flags = parseGlobalFlags(program.opts());

	if (detectMode(flags) === "json") {
		process.stderr.write(`${JSON.stringify(mapped.toJSON())}\n`);
	} else {
		process.stderr.write(`\x1b[31m✗\x1b[0m ${mapped.human}\n`);
		if (mapped.hint) process.stderr.write(`  ${mapped.hint}\n`);
	}
	process.exit(mapped.exitCode);
}
