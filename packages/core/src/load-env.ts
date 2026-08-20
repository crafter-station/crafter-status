import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Load the monorepo's root `.env` into `process.env` for local development.
 *
 * Every app runs from its own directory, and neither Bun nor Next walks up to find
 * a shared env file. In production nothing calls this with a file present — the
 * platform injects real environment variables — and existing values always win, so
 * this can never override a deployed secret.
 */
export function loadRootEnv(startDir: string = process.cwd()): void {
	const path = findUp(".env", startDir);
	if (!path) return;

	for (const line of readFileSync(path, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;

		const key = trimmed.slice(0, eq).trim();
		if (!key || process.env[key] !== undefined) continue;

		let value = trimmed.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		process.env[key] = value;
	}
}

function findUp(filename: string, from: string): string | null {
	let dir = resolve(from);

	for (;;) {
		const candidate = join(dir, filename);
		if (existsSync(candidate)) return candidate;

		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}
