import type { Command } from "commander";
import { parseGlobalFlags } from "../cli/global-flags.ts";
import { clearGroupsCache, loadGroupsCache, saveGroupsCache } from "../lib/cache.ts";
import { initWhatsApp, listGroups } from "../lib/whatsapp.ts";
import { emit } from "./emit.ts";
import * as ui from "./render.ts";

export function registerGroups(program: Command): void {
	const cmd = program.command("groups").description("Inspect WhatsApp groups");

	cmd
		.command("list")
		.description("List groups this account belongs to (cached locally — use --refresh to update)")
		.option("--refresh", "Bypass the cache and re-fetch groups from WhatsApp")
		.action(async function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const opts = this.opts();
			const refresh = opts.refresh === true;

			const cached = refresh ? null : loadGroupsCache();
			let groups = cached?.groups ?? null;
			let fetchedAt = cached?.fetchedAt ?? null;
			let fromCache = groups !== null;

			if (!groups) {
				ui.info("Connecting to WhatsApp… (this can take 10-30s on cold start)");
				const handle = await initWhatsApp({ verbose: flags.verbose });
				try {
					groups = await listGroups(handle.client);
				} finally {
					await handle.close();
				}
				const saved = saveGroupsCache(groups);
				fetchedAt = saved.fetchedAt;
				fromCache = false;
			}

			const result = {
				groups,
				fromCache,
				fetchedAt,
			};

			emit(result, flags, (r) => {
				ui.header(`Groups (${r.groups.length})`);
				if (r.groups.length === 0) {
					ui.kv("Groups", "none");
					return;
				}
				ui.table(r.groups, [
					{ key: "name", label: "Name", width: 36 },
					{ key: "participantCount", label: "Members", width: 8 },
					{ key: "id", label: "ID", width: 38 },
				]);
				if (r.fetchedAt) {
					const stamp = new Date(r.fetchedAt).toLocaleString();
					process.stdout.write(
						`\n  ${r.fromCache ? "cached" : "fetched"} ${stamp}${r.fromCache ? "  (run with --refresh to update)" : ""}\n`,
					);
				}
				process.stdout.write("\n");
			});
		});

	cmd
		.command("refresh")
		.description("Force-refresh the cached groups list")
		.action(async function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			ui.info("Connecting to WhatsApp…");
			const handle = await initWhatsApp({ verbose: flags.verbose });
			let groups;
			try {
				groups = await listGroups(handle.client);
			} finally {
				await handle.close();
			}
			const saved = saveGroupsCache(groups);

			emit(
				{ ok: true, count: groups.length, fetchedAt: saved.fetchedAt },
				flags,
				(r) => {
					ui.success(`Cached ${r.count} group(s).`);
				},
			);
		});

	cmd
		.command("cache-clear")
		.description("Delete the cached groups list")
		.action(function (this: Command) {
			clearGroupsCache();
			ui.success("Groups cache cleared.");
		});
}
