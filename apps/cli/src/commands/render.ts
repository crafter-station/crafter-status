import pc from "picocolors";

export function kv(label: string, value: string | number | boolean | null | undefined): void {
	const display = value === null || value === undefined ? pc.dim("—") : String(value);
	process.stdout.write(`  ${pc.bold(label.padEnd(18))} ${display}\n`);
}

export function header(text: string): void {
	process.stdout.write(`\n${pc.bold(pc.cyan(text))}\n`);
}

export function table(
	rows: Record<string, string | number | boolean | null | undefined>[],
	columns: { key: string; label: string; width?: number }[],
): void {
	if (rows.length === 0) {
		process.stdout.write(pc.dim("  (empty)\n"));
		return;
	}

	const headerLine = columns.map((col) => pc.bold(col.label.padEnd(col.width ?? 20))).join("  ");
	process.stdout.write(`  ${headerLine}\n`);

	const sep = columns.map((col) => "─".repeat(col.width ?? 20)).join("──");
	process.stdout.write(`  ${pc.dim(sep)}\n`);

	for (const row of rows) {
		const line = columns
			.map((col) => {
				const val = row[col.key];
				const str = val === null || val === undefined ? "—" : String(val);
				return str.padEnd(col.width ?? 20);
			})
			.join("  ");
		process.stdout.write(`  ${line}\n`);
	}
}

export function success(text: string): void {
	process.stdout.write(`${pc.green("✓")} ${text}\n`);
}

export function warn(text: string): void {
	process.stderr.write(`${pc.yellow("!")} ${text}\n`);
}

export function error(text: string): void {
	process.stderr.write(`${pc.red("✗")} ${text}\n`);
}

export function info(text: string): void {
	process.stderr.write(`${pc.dim(text)}\n`);
}
