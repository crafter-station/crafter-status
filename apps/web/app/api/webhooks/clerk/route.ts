import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { getDb, users } from "@crafter/db";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

/**
 * Keeps the `users` mirror in step with Clerk. Clerk remains the source of truth
 * for identity; this table only exists so tokens can hang off a user row and so the
 * org verdict has somewhere to be cached.
 */
export async function POST(req: NextRequest) {
	let event: Awaited<ReturnType<typeof verifyWebhook>>;
	try {
		event = await verifyWebhook(req);
	} catch (e) {
		return new Response(
			`Webhook verification failed: ${e instanceof Error ? e.message : String(e)}`,
			{
				status: 400,
			},
		);
	}

	const db = getDb();

	if (event.type === "user.created" || event.type === "user.updated") {
		const data = event.data;
		const github = data.external_accounts?.find((a) => a.provider === "oauth_github");
		const row = {
			id: data.id,
			githubLogin: github?.username ?? data.username ?? null,
			name: [data.first_name, data.last_name].filter(Boolean).join(" ") || data.username || null,
			email: data.email_addresses?.[0]?.email_address ?? null,
			avatarUrl: data.image_url ?? null,
			updatedAt: new Date(),
		};

		// Deliberately does not touch role / isOrgMember / orgCheckedAt — those are
		// owned by the GitHub check, and a profile edit is not a re-authorization.
		await db.insert(users).values(row).onConflictDoUpdate({ target: users.id, set: row });
	}

	if (event.type === "user.deleted" && event.data.id) {
		await db.delete(users).where(eq(users.id, event.data.id));
	}

	return new Response("ok", { status: 200 });
}
