"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Polls the server component tree while something transient is on screen — the
 * pairing QR, mostly, which the ingestor rotates every ~20s.
 */
export function AutoRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
	const router = useRouter();

	useEffect(() => {
		const timer = setInterval(() => router.refresh(), intervalMs);
		return () => clearInterval(timer);
	}, [router, intervalMs]);

	return null;
}
