"use client";

import { useState, useTransition } from "react";
import { Button, SectionLabel } from "@/components/ui";
import type { ActionResult, TokenResult } from "@/lib/actions";

export type TokenRow = {
	id: string;
	name: string;
	prefix: string;
	lastUsedAt: Date | null;
	revokedAt: Date | null;
	createdAt: Date;
};

type Props = {
	tokens: TokenRow[];
	mint: (formData: FormData) => Promise<TokenResult>;
	revoke: (tokenId: string) => Promise<ActionResult>;
};

export function TokenManager({ tokens, mint, revoke }: Props) {
	const [pending, startTransition] = useTransition();
	const [minted, setMinted] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const active = tokens.filter((t) => !t.revokedAt);

	return (
		<div className="space-y-3">
			<form
				action={(formData) => {
					setError(null);
					setMinted(null);
					startTransition(async () => {
						const result = await mint(formData);
						if (result.ok) setMinted(result.plaintext ?? null);
						else setError(result.error);
					});
				}}
				className="flex flex-wrap items-center gap-2"
			>
				<input
					name="name"
					placeholder="Token name (e.g. codex-laptop)"
					required
					className="h-8 flex-1 min-w-48 rounded-md border border-[var(--border)] bg-transparent px-2.5 text-[0.8125rem] outline-none focus:border-[var(--muted)]"
				/>
				<Button type="submit" disabled={pending}>
					{pending ? "Minting…" : "Mint token"}
				</Button>
			</form>

			{error ? <p className="text-[0.75rem] text-[var(--danger)]">{error}</p> : null}

			{minted ? (
				<div className="rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-3">
					<SectionLabel>Copy this now — it is never shown again</SectionLabel>
					<code className="mt-1.5 block break-all font-mono text-[0.75rem]">{minted}</code>
					<button
						type="button"
						onClick={() => navigator.clipboard.writeText(minted)}
						className="mt-2 text-[0.75rem] underline underline-offset-2"
					>
						Copy to clipboard
					</button>
				</div>
			) : null}

			{active.length === 0 ? (
				<p className="text-[0.8125rem] text-[var(--muted)]">No active tokens.</p>
			) : (
				<ul className="divide-y divide-[var(--border)]">
					{active.map((token) => (
						<li key={token.id} className="flex items-center gap-3 py-2">
							<div className="min-w-0 flex-1">
								<p className="truncate text-[0.8125rem]">{token.name}</p>
								<p className="font-mono text-[0.6875rem] text-[var(--muted)]">
									{token.prefix}… · last used{" "}
									{token.lastUsedAt ? token.lastUsedAt.toLocaleDateString() : "never"}
								</p>
							</div>
							<Button
								variant="danger"
								disabled={pending}
								onClick={() => {
									if (!window.confirm(`Revoke "${token.name}"? Any client using it stops working.`))
										return;
									startTransition(async () => {
										const result = await revoke(token.id);
										if (!result.ok) setError(result.error);
									});
								}}
							>
								Revoke
							</Button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
