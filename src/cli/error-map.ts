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
		return {
			ok: false,
			code: this.code,
			error: this.human,
			hint: this.hint,
		};
	}
}

export function mapError(error: unknown): AppError {
	if (error instanceof AppError) return error;
	if (error instanceof Error) {
		const msg = error.message;
		if (msg.includes("Evaluation failed") || msg.includes("Protocol error")) {
			return new AppError(
				"WHATSAPP_BROWSER_ERROR",
				{
					human: "WhatsApp Web browser session failed.",
					hint: "Try `crafter logout` to clear state, then `crafter login` to pair again.",
					exitCode: 5,
				},
				error,
			);
		}
		if (msg.includes("ENOENT") && msg.includes("chrome")) {
			return new AppError(
				"CHROMIUM_MISSING",
				{
					human: "Chromium not found.",
					hint: "Run `bunx puppeteer browsers install chrome` to install it.",
					exitCode: 6,
				},
				error,
			);
		}
		if (msg.includes("401") || msg.includes("Incorrect API key")) {
			return new AppError(
				"OPENAI_UNAUTHORIZED",
				{
					human: "OpenAI rejected the API key.",
					hint: "Run `crafter config set` to update it.",
				},
				error,
			);
		}
		return new AppError("UNKNOWN", { human: msg }, error);
	}
	return new AppError("UNKNOWN", { human: String(error) });
}
