const stamp = () => new Date().toISOString();

export const log = {
	info: (msg: string) => process.stdout.write(`${stamp()} info  ${msg}\n`),
	warn: (msg: string) => process.stdout.write(`${stamp()} warn  ${msg}\n`),
	error: (msg: string) => process.stderr.write(`${stamp()} error ${msg}\n`),
};
