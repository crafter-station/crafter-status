import { homedir } from "node:os";
import { join } from "node:path";

export const VERSION = "0.1.0";
export const CLI_NAME = "crafter";
export const USER_AGENT = `@crafter/crafter-status/${VERSION}`;

export const CONFIG_DIR = join(homedir(), ".crafter");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const SESSION_DIR = join(CONFIG_DIR, "session");
export const GROUPS_CACHE_FILE = join(CONFIG_DIR, "groups-cache.json");

export const DEFAULT_MODEL = "gpt-4o-mini";
export const DEFAULT_MESSAGE_LIMIT = 200;
