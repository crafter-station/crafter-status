import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import type { Database } from "./client.ts";
import { apiTokens, users } from "./schema.ts";

const TOKEN_PREFIX = "crft_";
const PREFIX_DISPLAY_CHARS = 12;

function hash(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export type MintedToken = {
	id: string;
	name: string;
	/** Shown exactly once, at creation. Never stored. */
	plaintext: string;
	prefix: string;
};

export async function createApiToken(
	db: Database,
	args: { userId: string; name: string; expiresAt?: Date },
): Promise<MintedToken> {
	const plaintext = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;

	const [row] = await db
		.insert(apiTokens)
		.values({
			userId: args.userId,
			name: args.name,
			prefix: plaintext.slice(0, PREFIX_DISPLAY_CHARS),
			tokenHash: hash(plaintext),
			expiresAt: args.expiresAt ?? null,
		})
		.returning();

	if (!row) throw new Error("Failed to create API token.");
	return { id: row.id, name: row.name, plaintext, prefix: row.prefix };
}

export type TokenPrincipal = {
	userId: string;
	tokenId: string;
	role: "admin" | "member";
	isOrgMember: boolean;
};

/**
 * Resolve a `crft_…` bearer token to its owner. Returns null for unknown, revoked,
 * or expired tokens, and for owners who have since fallen out of the GitHub org.
 */
export async function verifyApiToken(
	db: Database,
	plaintext: string,
): Promise<TokenPrincipal | null> {
	if (!plaintext.startsWith(TOKEN_PREFIX)) return null;

	const [row] = await db
		.select({
			tokenId: apiTokens.id,
			userId: apiTokens.userId,
			role: users.role,
			isOrgMember: users.isOrgMember,
		})
		.from(apiTokens)
		.innerJoin(users, eq(users.id, apiTokens.userId))
		.where(
			and(
				eq(apiTokens.tokenHash, hash(plaintext)),
				isNull(apiTokens.revokedAt),
				or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date())),
			),
		)
		.limit(1);

	if (!row?.isOrgMember) return null;

	// Best-effort; a failed touch must not fail the request.
	void db
		.update(apiTokens)
		.set({ lastUsedAt: new Date() })
		.where(eq(apiTokens.id, row.tokenId))
		.catch(() => {});

	return row;
}

export async function listApiTokens(db: Database, userId: string) {
	return db
		.select({
			id: apiTokens.id,
			name: apiTokens.name,
			prefix: apiTokens.prefix,
			lastUsedAt: apiTokens.lastUsedAt,
			expiresAt: apiTokens.expiresAt,
			revokedAt: apiTokens.revokedAt,
			createdAt: apiTokens.createdAt,
		})
		.from(apiTokens)
		.where(eq(apiTokens.userId, userId))
		.orderBy(desc(apiTokens.createdAt));
}

export async function revokeApiToken(
	db: Database,
	userId: string,
	tokenId: string,
): Promise<boolean> {
	const revoked = await db
		.update(apiTokens)
		.set({ revokedAt: new Date() })
		.where(
			and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)),
		)
		.returning({ id: apiTokens.id });
	return revoked.length > 0;
}
