import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { CONFIG_DIR, GROUPS_CACHE_FILE } from "../constants.ts";
import type { GroupSummary } from "../types.ts";

export type GroupsCache = {
	fetchedAt: number;
	groups: GroupSummary[];
};

export function loadGroupsCache(): GroupsCache | null {
	if (!existsSync(GROUPS_CACHE_FILE)) return null;
	try {
		const raw = readFileSync(GROUPS_CACHE_FILE, "utf8");
		const parsed = JSON.parse(raw) as GroupsCache;
		if (!Array.isArray(parsed.groups) || typeof parsed.fetchedAt !== "number") return null;
		return parsed;
	} catch {
		return null;
	}
}

export function saveGroupsCache(groups: GroupSummary[]): GroupsCache {
	mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o755 });
	const payload: GroupsCache = { fetchedAt: Date.now(), groups };
	writeFileSync(GROUPS_CACHE_FILE, JSON.stringify(payload, null, "\t"), {
		encoding: "utf8",
		mode: 0o600,
	});
	return payload;
}

export function clearGroupsCache(): void {
	if (existsSync(GROUPS_CACHE_FILE)) {
		unlinkSync(GROUPS_CACHE_FILE);
	}
}
