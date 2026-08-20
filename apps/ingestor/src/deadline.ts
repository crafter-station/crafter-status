/**
 * Bound a promise that talks to the browser.
 *
 * Puppeteer's own protocol timeout is 180s, and a page call that hangs that long
 * inside the reconnect path stops everything behind it — the catalogue refresh
 * blocked backfill for minutes with no trace of why. A deadline turns an invisible
 * stall into a recorded failure.
 */
export function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
	return Promise.race([
		work,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s ${what}`)), ms),
		),
	]);
}
