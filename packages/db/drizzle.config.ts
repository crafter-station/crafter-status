import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs this file through its own loader, so it reads the root .env
// directly rather than importing the shared helper from @crafter/core.
if (!process.env.DATABASE_URL && existsSync("../../.env")) {
	for (const line of readFileSync("../../.env", "utf8").split("\n")) {
		const [key, ...rest] = line.trim().split("=");
		if (key === "DATABASE_URL") process.env.DATABASE_URL = rest.join("=");
	}
}

const url = process.env.DATABASE_URL;
if (!url) {
	throw new Error(
		"DATABASE_URL is not set. Copy .env.example to .env at the repo root and fill it in.",
	);
}

export default defineConfig({
	schema: "./src/schema.ts",
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: { url },
	casing: "snake_case",
});
