import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { CONFIG_DIR, CONFIG_FILE, DEFAULT_API_URL } from "../constants.ts";
import type { Config } from "../types.ts";
import { AppError } from "./error-map.ts";

export function configExists(): boolean {
	return existsSync(CONFIG_FILE);
}

export function loadConfig(): Config {
	if (!existsSync(CONFIG_FILE)) {
		throw new AppError("NOT_CONFIGURED", {
			human: "Not signed in.",
			hint: "Run `crafter login` and paste a token from the dashboard's Settings page.",
			exitCode: 4,
		});
	}

	const parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Partial<Config>;
	if (!parsed.token) {
		throw new AppError("NOT_CONFIGURED", {
			human: "Config is missing a token.",
			hint: "Run `crafter login` to sign in again.",
			exitCode: 4,
		});
	}

	return {
		apiUrl: (parsed.apiUrl || DEFAULT_API_URL).replace(/\/$/, ""),
		token: parsed.token,
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
	if (existsSync(CONFIG_FILE)) unlinkSync(CONFIG_FILE);
}

export function redactToken(token: string): string {
	if (token.length <= 12) return "****";
	return `${token.slice(0, 12)}…`;
}
