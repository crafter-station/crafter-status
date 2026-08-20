"use client";

import { type ReactNode, useState, useTransition } from "react";
import { Button } from "@/components/ui";
import type { ActionResult } from "@/lib/actions";

type Props = {
	action: () => Promise<ActionResult>;
	children: ReactNode;
	pendingLabel?: string;
	variant?: "default" | "ghost" | "danger";
	confirm?: string;
	className?: string;
};

/**
 * Wraps a bound server action with pending state and inline feedback. Errors are
 * shown next to the control that caused them rather than thrown into an error
 * boundary — a failed backfill shouldn't blank the settings page.
 */
export function ActionButton({
	action,
	children,
	pendingLabel = "Working…",
	variant = "ghost",
	confirm,
	className,
}: Props) {
	const [pending, startTransition] = useTransition();
	const [result, setResult] = useState<ActionResult | null>(null);

	return (
		<span className="inline-flex items-center gap-2">
			<Button
				type="button"
				variant={variant}
				disabled={pending}
				className={className}
				onClick={() => {
					if (confirm && !window.confirm(confirm)) return;
					setResult(null);
					startTransition(async () => setResult(await action()));
				}}
			>
				{pending ? pendingLabel : children}
			</Button>
			{result ? (
				<span
					className={`text-[0.75rem] ${result.ok ? "text-[var(--muted)]" : "text-[var(--danger)]"}`}
					role="status"
				>
					{result.ok ? result.message : result.error}
				</span>
			) : null}
		</span>
	);
}

export function ToggleTracked({
	action,
	tracked,
	label,
}: {
	action: (next: boolean) => Promise<ActionResult>;
	tracked: boolean;
	label: string;
}) {
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);

	return (
		<span className="inline-flex items-center gap-2">
			<button
				type="button"
				role="switch"
				aria-checked={tracked}
				aria-label={`Track ${label}`}
				disabled={pending}
				onClick={() => {
					setError(null);
					startTransition(async () => {
						const result = await action(!tracked);
						if (!result.ok) setError(result.error);
					});
				}}
				className={`relative h-5 w-9 shrink-0 rounded-full border transition disabled:opacity-50 ${
					tracked
						? "border-[var(--accent)]/50 bg-[var(--accent)]/30"
						: "border-[var(--border)] bg-[var(--border)]/40"
				}`}
			>
				<span
					className={`absolute top-0.5 size-3.5 rounded-full bg-[var(--fg)] transition-all ${
						tracked ? "left-[1.125rem]" : "left-0.5"
					}`}
				/>
			</button>
			{error ? <span className="text-[0.75rem] text-[var(--danger)]">{error}</span> : null}
		</span>
	);
}
