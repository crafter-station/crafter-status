export class AppError extends Error {
	code: string;
	human: string;
	hint?: string;
	exitCode: number;

	constructor(
		code: string,
		opts: { human: string; hint?: string; exitCode?: number },
		cause?: unknown,
	) {
		super(opts.human);
		this.name = "AppError";
		this.code = code;
		this.human = opts.human;
		this.hint = opts.hint;
		this.exitCode = opts.exitCode ?? 1;
		if (cause) this.cause = cause;
	}

	toJSON() {
		return { ok: false, code: this.code, error: this.human, hint: this.hint };
	}
}

export function mapError(error: unknown): AppError {
	if (error instanceof AppError) return error;

	if (error instanceof Error) {
		const msg = error.message;

		if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED")) {
			return new AppError(
				"UNREACHABLE",
				{
					human: "Could not reach the Crafter Status server.",
					hint: "Check `crafter config show`, or the deployment may be down.",
					exitCode: 7,
				},
				error,
			);
		}
		if (msg.includes("401") || msg.includes("Unauthorized")) {
			return new AppError(
				"UNAUTHORIZED",
				{
					human: "Your token was rejected.",
					hint: "Mint a new token in Settings → MCP endpoint, then run `crafter login`.",
					exitCode: 4,
				},
				error,
			);
		}
		if (msg.includes("not an active member")) {
			return new AppError(
				"FORBIDDEN",
				{
					human: "Your GitHub account is not an active member of the organization.",
					exitCode: 3,
				},
				error,
			);
		}

		return new AppError("UNKNOWN", { human: msg }, error);
	}

	return new AppError("UNKNOWN", { human: String(error) });
}
