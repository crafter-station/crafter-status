import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn("rounded-lg border border-[var(--border)] bg-[var(--panel)]", className)}
			{...props}
		/>
	);
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<span
			className={cn(
				"font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-[var(--muted)]",
				className,
			)}
		>
			{children}
		</span>
	);
}

type BadgeTone = "neutral" | "good" | "warn" | "bad";

const TONES: Record<BadgeTone, string> = {
	neutral: "border-[var(--border)] text-[var(--muted)]",
	good: "border-[var(--accent)]/40 text-[var(--accent)]",
	warn: "border-[var(--warn)]/40 text-[var(--warn)]",
	bad: "border-[var(--danger)]/40 text-[var(--danger)]",
};

export function Badge({
	tone = "neutral",
	children,
	className,
}: {
	tone?: BadgeTone;
	children: ReactNode;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[0.6875rem] uppercase tracking-[0.06em]",
				TONES[tone],
				className,
			)}
		>
			{children}
		</span>
	);
}

export function Dot({ tone = "neutral" }: { tone?: BadgeTone }) {
	const color =
		tone === "good"
			? "bg-[var(--accent)]"
			: tone === "warn"
				? "bg-[var(--warn)]"
				: tone === "bad"
					? "bg-[var(--danger)]"
					: "bg-[var(--muted)]";
	return <span className={cn("size-1.5 rounded-full", color)} aria-hidden />;
}

export function Button({
	variant = "default",
	className,
	...props
}: ComponentProps<"button"> & { variant?: "default" | "ghost" | "danger" }) {
	const variants = {
		default:
			"border-[var(--border)] bg-[var(--fg)] text-[var(--bg)] hover:opacity-90 disabled:opacity-40",
		ghost:
			"border-[var(--border)] bg-transparent text-[var(--fg)] hover:bg-[var(--border)]/40 disabled:opacity-40",
		danger:
			"border-[var(--danger)]/40 bg-transparent text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-40",
	};
	return (
		<button
			className={cn(
				"inline-flex h-8 items-center gap-2 rounded-md border px-3 text-[0.8125rem] font-medium transition disabled:cursor-not-allowed",
				variants[variant],
				className,
			)}
			{...props}
		/>
	);
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
	return (
		<div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--border)] px-6 py-12 text-center">
			<p className="text-sm text-[var(--fg)]">{title}</p>
			{hint ? <p className="text-[0.8125rem] text-[var(--muted)]">{hint}</p> : null}
		</div>
	);
}
