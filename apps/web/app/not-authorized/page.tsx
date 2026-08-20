import { SignOutButton } from "@clerk/nextjs";
import { Panel } from "@/components/ui";
import { type AccessReason, GITHUB_ORG, getAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Copy = { title: string; body: React.ReactNode; hint?: string };

/**
 * The reason matters. "We could not read your membership" and "you are not a
 * member" look identical to the person locked out, but the fix lives in completely
 * different places — so say which one happened.
 */
function copyFor(reason: AccessReason | null, login: string | null): Copy {
	switch (reason) {
		case "scope_missing":
			return {
				title: "Can't read your membership",
				body: (
					<>
						GitHub refused to tell us whether{" "}
						<span className="font-mono">{login ?? "your account"}</span> belongs to{" "}
						<span className="font-mono">{GITHUB_ORG}</span>. This is a configuration problem on our
						side, not a problem with your account.
					</>
				),
				hint: `The Clerk GitHub connection needs the read:org scope. An admin has to add it in the Clerk dashboard under SSO connections; it requires custom GitHub credentials, since Clerk's shared ones cannot request extra scopes.`,
			};
		case "no_token":
			return {
				title: "No GitHub connection",
				body: <>Your account has no linked GitHub identity, so membership can't be checked.</>,
				hint: "Sign out and sign in again using the Sign in with GitHub button.",
			};
		case "pending_invite":
			return {
				title: "Invitation not accepted",
				body: (
					<>
						You have a pending invitation to <span className="font-mono">{GITHUB_ORG}</span> that
						hasn't been accepted yet.
					</>
				),
				hint: "Accept it on GitHub, then reload this page.",
			};
		case "github_error":
			return {
				title: "GitHub is not answering",
				body: <>We couldn't reach GitHub to verify your membership.</>,
				hint: "This is usually temporary — reload in a minute.",
			};
		default:
			return {
				title: "Not authorized",
				body: (
					<>
						Crafter Status is limited to members of the{" "}
						<span className="font-mono">{GITHUB_ORG}</span> GitHub organization.{" "}
						<span className="font-mono">{login ?? "Your account"}</span> is not an active member of
						it.
					</>
				),
				hint: "If you were just added, reload this page — membership is re-checked on every attempt.",
			};
	}
}

export default async function NotAuthorized() {
	// Refusals are never cached, so this re-runs the real check: the moment the
	// cause is fixed, this page stops being reachable.
	const access = await getAccess();
	const { title, body, hint } = copyFor(access?.reason ?? null, access?.githubLogin ?? null);

	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6">
			<Panel className="w-full p-6 text-center">
				<h1 className="text-base font-semibold">{title}</h1>
				<p className="mt-2 text-sm text-[var(--muted)]">{body}</p>
				{hint ? <p className="mt-4 text-[0.8125rem] text-[var(--muted)]">{hint}</p> : null}

				<div className="mt-5 flex items-center justify-center gap-2">
					<a
						href="/"
						className="inline-flex h-8 items-center rounded-md border border-[var(--border)] px-3 text-[0.8125rem]"
					>
						Try again
					</a>
					<SignOutButton>
						<button
							type="button"
							className="h-8 rounded-md border border-[var(--border)] px-3 text-[0.8125rem]"
						>
							Sign out
						</button>
					</SignOutButton>
				</div>
			</Panel>
		</main>
	);
}
