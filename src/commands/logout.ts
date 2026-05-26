import { confirm } from "@clack/prompts";
import type { Command } from "commander";
import { parseGlobalFlags } from "../cli/global-flags.ts";
import { clearGroupsCache } from "../lib/cache.ts";
import { clearSession, sessionExists } from "../lib/whatsapp.ts";
import * as ui from "./render.ts";

export function registerLogout(program: Command): void {
	program
		.command("logout")
		.description("Remove the stored WhatsApp session")
		.action(async function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());

			if (!sessionExists()) {
				ui.warn("No session to remove.");
				return;
			}

			if (!flags.yes) {
				const ok = await confirm({
					message: "Remove WhatsApp session? You'll need to re-pair to use the CLI.",
				});
				if (ok !== true) {
					ui.warn("Cancelled.");
					return;
				}
			}

			clearSession();
			clearGroupsCache();
			ui.success("Session and groups cache removed.");
		});
}
