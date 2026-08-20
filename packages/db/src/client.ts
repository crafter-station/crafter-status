import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(url: string, opts: { max?: number } = {}) {
	const client = postgres(url, {
		max: opts.max ?? 5,
		// Neon terminates idle connections; keep the pool small and let it recycle.
		idle_timeout: 20,
		connect_timeout: 15,
		prepare: false,
	});
	return drizzle(client, { schema, casing: "snake_case" });
}

let cached: Database | null = null;

/**
 * Process-wide singleton. Next.js re-evaluates modules on every hot reload, so
 * without this each edit would open a new Neon pool until the connection limit bites.
 */
export function getDb(): Database {
	if (cached) return cached;

	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error("DATABASE_URL is not set.");
	}
	cached = createDatabase(url);
	return cached;
}
