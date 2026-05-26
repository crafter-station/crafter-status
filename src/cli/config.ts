import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { CONFIG_DIR, CONFIG_FILE, DEFAULT_MODEL } from "../constants.ts";
import type { Config } from "../types.ts";

export function configExists(): boolean {
	return existsSync(CONFIG_FILE);
}

export function loadConfig(): Config {
	if (!existsSync(CONFIG_FILE)) {
		throw new Error("Config not found. Run `crafter config set` to configure your OpenAI API key.");
	}
	const raw = readFileSync(CONFIG_FILE, "utf8");
	const parsed = JSON.parse(raw) as Partial<Config>;
	if (!parsed.openaiApiKey) {
		throw new Error("Invalid config. Run `crafter config set` to reconfigure.");
	}
	return {
		openaiApiKey: parsed.openaiApiKey,
		model: parsed.model || DEFAULT_MODEL,
	};
}

export function saveConfig(config: Config): void {
	mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o755 });
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, "\t"), {
		encoding: "utf8",
		mode: 0o600,
	});
}

export function resetConfig(): void {
	if (existsSync(CONFIG_FILE)) {
		unlinkSync(CONFIG_FILE);
	}
}

export function redactApiKey(key: string): string {
	if (key.length <= 8) return "****";
	return `${key.slice(0, 4)}..${key.slice(-4)}`;
}
