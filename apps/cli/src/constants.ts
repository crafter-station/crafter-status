import { homedir } from "node:os";
import { join } from "node:path";

export const VERSION = "0.2.0";
export const CLI_NAME = "crafter";
export const USER_AGENT = `@crafter/cli/${VERSION}`;

export const CONFIG_DIR = join(homedir(), ".crafter");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export const DEFAULT_API_URL = "https://wspstatus.crafter.run";
