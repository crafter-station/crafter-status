import "server-only";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getDb, users } from "@crafter/db";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

const GITHUB_ORG = process.env.GITHUB_ORG ?? "crafter-station";

/**
 * Explicit admin allowlist by GitHub login, comma-separated.
 *
 * Org *owner* is the normal route to admin, but that is only visible through the
 * scoped membership call — so on an instance where that call is refused, nobody
 * could ever become admin and nobody could pair WhatsApp. This is the bootstrap
 * out of that deadlock, and a break-glass if the org roles ever disagree with who
 * should be operating this.
 */
const ADMIN_LOGINS = (process.env.ADMIN_GITHUB_LOGINS ?? "")
	.split(",")
	.map((s) => s.trim().toLowerCase())
	.filter(Boolean);

function isAdmin(isOwner: boolean, login: string | null): boolean {
	if (isOwner) return true;
	return login !== null && ADMIN_LOGINS.includes(login.toLowerCase());
}
/** How long a *positive* membership verdict is trusted before we ask GitHub again. */
const RECHECK_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Why access was granted or refused. `scope_missing` is deliberately distinct from
 * `not_member`: GitHub answers 403 when the token is not allowed to read org
 * membership at all, which is a configuration problem on our side and says nothing
 * about whether the person is in the organization. Collapsing the two sends people
 * off to fix their GitHub account when the fix is in the Clerk dashboard.
 */
export type AccessReason =
	| "member"
	| "not_member"
	| "pending_invite"
	| "scope_missing"
	| "no_token"
	| "github_error";

export type Access = {
	userId: string;
	isOrgMember: boolean;
	role: "admin" | "member";
	reason: AccessReason;
	githubLogin: string | null;
	name: string | null;
	avatarUrl: string | null;
};

type GithubMembership = {
	state: string;
	role: string;
	user?: { login?: string };
};

type MembershipCheck = {
	reason: AccessReason;
	isOwner: boolean;
	login: string | null;
};

/**
 * Ask GitHub whether this user is in the org, using the user's own OAuth token.
 * `GET /user/memberships/orgs/{org}` reports private memberships too — but only if
 * the Clerk GitHub connection requests the `read:org` scope. Without it GitHub
 * refuses to answer rather than answering "no".
 */
async function checkGithubMembership(
	userId: string,
	login: string | null,
): Promise<MembershipCheck> {
	const client = await clerkClient();
	const tokens = await client.users.getUserOauthAccessToken(userId, "github");
	const token = tokens.data[0]?.token;

	if (!token) return publicFallback(login, "no_token");

	const response = await fetch(`https://api.github.com/user/memberships/orgs/${GITHUB_ORG}`, {
		headers: {
			authorization: `Bearer ${token}`,
			accept: "application/vnd.github+json",
			"x-github-api-version": "2022-11-28",
		},
		cache: "no-store",
	});

	// 403 means the token may not read org membership — almost always a missing
	// `read:org` scope on the Clerk GitHub connection.
	if (response.status === 403) return publicFallback(login, "scope_missing");
	if (response.status === 404) return { reason: "not_member", isOwner: false, login };

	if (!response.ok) return { reason: "github_error", isOwner: false, login };

	const body = (await response.json()) as GithubMembership;
	return {
		reason: body.state === "active" ? "member" : "pending_invite",
		isOwner: body.role === "admin",
		login: body.user?.login ?? login,
	};
}

/**
 * When the scoped check is refused, fall back to the public members list, which
 * needs no authentication at all.
 *
 * This can only ever *grant* access it could not otherwise prove: a public
 * membership is a membership. It cannot see private members, so `read:org` remains
 * the real fix — but it means a public member is not locked out of their own
 * workspace waiting for a dashboard change. The original refusal reason is kept
 * when the fallback finds nothing, so the page still points at the right fix.
 */
async function publicFallback(
	login: string | null,
	refusal: AccessReason,
): Promise<MembershipCheck> {
	if (!login) return { reason: refusal, isOwner: false, login };

	try {
		const response = await fetch(
			`https://api.github.com/orgs/${GITHUB_ORG}/public_members/${encodeURIComponent(login)}`,
			{ headers: { accept: "application/vnd.github+json" }, cache: "no-store" },
		);
		// 204 = public member. 404 = not public (may still be a private member).
		if (response.status === 204) return { reason: "member", isOwner: false, login };
	} catch {
		// Fall through to the original refusal.
	}

	return { reason: refusal, isOwner: false, login };
}

export async function getAccess(): Promise<Access | null> {
	const { userId } = await auth();
	if (!userId) return null;
	return resolveAccessForUser(userId);
}

/**
 * Same verdict, resolved from a bare Clerk user id rather than a browser session.
 * The MCP endpoint needs this: a client that authenticated over OAuth may never
 * have loaded the dashboard, so there may be no `users` row to read yet.
 *
 * Only *granted* access is cached. A refusal is re-checked on every request, so
 * fixing the cause — being added to the org, or the `read:org` scope being
 * configured — takes effect on the next page load instead of in up to 24 hours.
 */
export async function resolveAccessForUser(userId: string): Promise<Access | null> {
	const db = getDb();
	const [existing] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

	const cachedAndFresh =
		existing?.isOrgMember &&
		existing.orgCheckedAt &&
		Date.now() - existing.orgCheckedAt.getTime() < RECHECK_AFTER_MS;

	if (existing && cachedAndFresh) {
		return {
			userId,
			isOrgMember: true,
			role: existing.role,
			reason: "member",
			githubLogin: existing.githubLogin,
			name: existing.name,
			avatarUrl: existing.avatarUrl,
		};
	}

	const client = await clerkClient();
	const clerkUser = await client.users.getUser(userId);
	const githubAccount = clerkUser.externalAccounts.find((a) => a.provider === "oauth_github");

	let membership: MembershipCheck;
	try {
		membership = await checkGithubMembership(userId, githubAccount?.username ?? null);
	} catch {
		// GitHub being unreachable must not lock out an already-verified member;
		// it only means we cannot refresh a stale verdict right now.
		if (existing?.isOrgMember) {
			return {
				userId,
				isOrgMember: true,
				role: existing.role,
				reason: "member",
				githubLogin: existing.githubLogin,
				name: existing.name,
				avatarUrl: existing.avatarUrl,
			};
		}
		membership = { reason: "github_error", isOwner: false, login: null };
	}

	const isMember = membership.reason === "member";

	const row = {
		id: userId,
		githubLogin: membership.login ?? githubAccount?.username ?? null,
		name:
			[clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
			clerkUser.username ||
			null,
		email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
		avatarUrl: clerkUser.imageUrl ?? null,
		role: (isAdmin(membership.isOwner, membership.login ?? githubAccount?.username ?? null)
			? "admin"
			: "member") as "admin" | "member",
		isOrgMember: isMember,
		// Left null on refusal so the next request re-checks rather than trusting a no.
		orgCheckedAt: isMember ? new Date() : null,
		updatedAt: new Date(),
	};

	await db.insert(users).values(row).onConflictDoUpdate({ target: users.id, set: row });

	return {
		userId,
		isOrgMember: isMember,
		role: row.role,
		reason: membership.reason,
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
