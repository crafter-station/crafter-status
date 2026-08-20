"use client";

import { useState, useTransition } from "react";
import { Button, SectionLabel } from "@/components/ui";
import type { ActionResult } from "@/lib/actions";

type Props = {
	save: (formData: FormData) => Promise<ActionResult>;
	timezone: string;
	todayRefreshMinutes: number;
	summaryModel: string;
};

const field =
	"h-8 rounded-md border border-[var(--border)] bg-transparent px-2.5 font-mono text-[0.8125rem] outline-none focus:border-[var(--muted)]";

export function SettingsForm({ save, timezone, todayRefreshMinutes, summaryModel }: Props) {
	const [pending, startTransition] = useTransition();
	const [result, setResult] = useState<ActionResult | null>(null);

	return (
		<form
			action={(formData) => {
				setResult(null);
				startTransition(async () => setResult(await save(formData)));
			}}
			className="mt-3 grid gap-3 sm:grid-cols-3"
		>
			<label className="flex flex-col gap-1">
				<SectionLabel>Timezone (day boundary)</SectionLabel>
				<input name="timezone" defaultValue={timezone} className={field} />
			</label>

			<label className="flex flex-col gap-1">
				<SectionLabel>Today refresh (minutes)</SectionLabel>
				<input
					name="todayRefreshMinutes"
					type="number"
					min={5}
					defaultValue={todayRefreshMinutes}
					className={field}
				/>
			</label>

			<label className="flex flex-col gap-1">
				<SectionLabel>Summary model</SectionLabel>
				<input name="summaryModel" defaultValue={summaryModel} className={field} />
			</label>

			<div className="flex items-center gap-3 sm:col-span-3">
				<Button type="submit" variant="default" disabled={pending}>
					{pending ? "Saving…" : "Save"}
				</Button>
				{result ? (
					<span
						className={`text-[0.75rem] ${result.ok ? "text-[var(--muted)]" : "text-[var(--danger)]"}`}
						role="status"
					>
						{result.ok ? result.message : result.error}
					</span>
				) : null}
			</div>
		</form>
	);
}
