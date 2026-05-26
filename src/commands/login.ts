import type { Command } from "commander";
import { parseGlobalFlags } from "../cli/global-flags.ts";
import { initWhatsApp, renderQR, sessionExists } from "../lib/whatsapp.ts";
import { emit } from "./emit.ts";
import * as ui from "./render.ts";

export function registerLogin(program: Command): void {
	program
		.command("login")
		.description("Pair WhatsApp by scanning a QR code with your phone")
		.action(async function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());

			if (sessionExists()) {
				ui.info("Existing session found — testing it.");
			}

			let qrShown = false;
			const handle = await initWhatsApp({
				verbose: flags.verbose,
				onQR: (qr) => {
					qrShown = true;
					ui.header("Scan this QR with WhatsApp → Linked Devices → Link a device");
					renderQR(qr);
					process.stderr.write("\nWaiting for scan…\n");
				},
			});

			const info = handle.client.info;
			const result = {
				ok: true,
				phone: info?.wid?.user ?? null,
				pushname: info?.pushname ?? null,
				newSession: qrShown,
			};

			await handle.close();

			emit(result, flags, () => {
				ui.success("WhatsApp linked.");
				ui.kv("Phone", result.phone);
				ui.kv("Name", result.pushname);
			});
		});
}
