import { SignOutButton } from "@clerk/nextjs";
import { Panel } from "@/components/ui";

const ORG = process.env.GITHUB_ORG ?? "crafter-station";

export default function NotAuthorized() {
	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6">
			<Panel className="w-full p-6 text-center">
				<h1 className="text-base font-semibold">Not authorized</h1>
				<p className="mt-2 text-sm text-[var(--muted)]">
					Crafter Status is limited to members of the <span className="font-mono">{ORG}</span>{" "}
					GitHub organization. Your GitHub account is not an active member of it.
				</p>
				<p className="mt-4 text-[0.8125rem] text-[var(--muted)]">
					If you were just added, sign out and back in — membership is re-checked on sign-in.
				</p>
				<div className="mt-5">
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
