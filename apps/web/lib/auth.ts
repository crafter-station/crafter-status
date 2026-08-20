import "server-only";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getDb, users } from "@crafter/db";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

const GITHUB_ORG = process.env.GITHUB_ORG ?? "crafter-station";
/** How long a membership verdict is trusted before we ask GitHub again. */
const RECHECK_AFTER_MS = 24 * 60 * 60 * 1000;

export type Access = {
	userId: string;
	isOrgMember: boolean;
	role: "admin" | "member";
	githubLogin: string | null;
	name: string | null;
	avatarUrl: string | null;
};

type GithubMembership = {
	state: string;
	role: string;
	user?: { login?: string };
};

/**
 * Ask GitHub whether this user is in the org, using the user's own OAuth token.
 * `GET /user/memberships/orgs/{org}` reports private memberships too, as long as
 * the Clerk GitHub connection requests the `read:org` scope — so no org-owned
 * GitHub App or PAT is needed.
 */
async function checkGithubMembership(
	userId: string,
): Promise<{ isMember: boolean; isOwner: boolean; login: string | null }> {
	const client = await clerkClient();
	const tokens = await client.users.getUserOauthAccessToken(userId, "github");
	const token = tokens.data[0]?.token;

	if (!token) return { isMember: false, isOwner: false, login: null };

	const response = await fetch(`https://api.github.com/user/memberships/orgs/${GITHUB_ORG}`, {
		headers: {
			authorization: `Bearer ${token}`,
			accept: "application/vnd.github+json",
			"x-github-api-version": "2022-11-28",
		},
		cache: "no-store",
	});

	if (response.status === 404 || response.status === 403) {
		return { isMember: false, isOwner: false, login: null };
	}
	if (!response.ok) {
		throw new Error(`GitHub membership check failed: ${response.status} ${await response.text()}`);
	}

	const body = (await response.json()) as GithubMembership;
	return {
		isMember: body.state === "active",
		isOwner: body.role === "admin",
		login: body.user?.login ?? null,
	};
}

/**
 * Resolve the signed-in user's access, re-verifying against GitHub at most once a
 * day. Someone who leaves the org loses access within 24h without us hitting the
 * GitHub API on every page load.
 */
export async function getAccess(): Promise<Access | null> {
	const { userId } = await auth();
	if (!userId) return null;
	return resolveAccessForUser(userId);
}

/**
 * Same verdict, resolved from a bare Clerk user id rather than a browser session.
 * The MCP endpoint needs this: a client that authenticated over OAuth may never
 * have loaded the dashboard, so there may be no `users` row to read yet.
 */
export async function resolveAccessForUser(userId: string): Promise<Access | null> {
	const db = getDb();
	const [existing] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

	const fresh =
		existing?.orgCheckedAt && Date.now() - existing.orgCheckedAt.getTime() < RECHECK_AFTER_MS;
	if (existing && fresh) {
		return {
			userId,
			isOrgMember: existing.isOrgMember,
			role: existing.role,
			githubLogin: existing.githubLogin,
			name: existing.name,
			avatarUrl: existing.avatarUrl,
		};
	}

	const client = await clerkClient();
	const clerkUser = await client.users.getUser(userId);

	let membership: { isMember: boolean; isOwner: boolean; login: string | null };
	try {
		membership = await checkGithubMembership(userId);
	} catch {
		// GitHub being unreachable must not lock out an already-verified member;
		// it only means we cannot upgrade a stale verdict right now.
		if (existing) {
			return {
				userId,
				isOrgMember: existing.isOrgMember,
				role: existing.role,
				githubLogin: existing.githubLogin,
				name: existing.name,
				avatarUrl: existing.avatarUrl,
			};
		}
		membership = { isMember: false, isOwner: false, login: null };
	}

	const githubAccount = clerkUser.externalAccounts.find((a) => a.provider === "oauth_github");
	const row = {
		id: userId,
		githubLogin: membership.login ?? githubAccount?.username ?? null,
		name:
			[clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
			clerkUser.username ||
			null,
		email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
		avatarUrl: clerkUser.imageUrl ?? null,
		role: (membership.isOwner ? "admin" : "member") as "admin" | "member",
		isOrgMember: membership.isMember,
		orgCheckedAt: new Date(),
		updatedAt: new Date(),
	};

	await db.insert(users).values(row).onConflictDoUpdate({ target: users.id, set: row });

	return {
		userId,
		isOrgMember: row.isOrgMember,
		role: row.role,
		githubLogin: row.githubLogin,
		name: row.name,
		avatarUrl: row.avatarUrl,
	};
}

/** Every page under the app shell goes through here. */
export async function requireAccess(): Promise<Access> {
	const access = await getAccess();
	if (!access) redirect("/sign-in");
	if (!access.isOrgMember) redirect("/not-authorized");
	return access;
}

export async function requireAdmin(): Promise<Access> {
	const access = await requireAccess();
	if (access.role !== "admin") {
		throw new Error("This action requires an admin (a GitHub organization owner).");
	}
	return access;
}

export { GITHUB_ORG };
