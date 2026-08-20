import { loadRootEnv } from "@crafter/core/load-env";
import type { NextConfig } from "next";

// Next only reads .env from the app directory; this repo keeps one at the root.
loadRootEnv(import.meta.dirname);

const config: NextConfig = {
	// The workspace packages ship TypeScript source rather than a build step.
	transpilePackages: ["@crafter/db", "@crafter/core"],
	serverExternalPackages: ["postgres"],
};

export default config;
