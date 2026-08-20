import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function formatDay(day: string, timezone: string): string {
	return new Intl.DateTimeFormat("en-GB", {
		timeZone: timezone,
		weekday: "short",
		day: "numeric",
		month: "short",
		year: "numeric",
	}).format(new Date(`${day}T12:00:00Z`));
}

export function relativeTime(date: Date | null): string {
	if (!date) return "never";
	const seconds = Math.round((Date.now() - date.getTime()) / 1000);
	if (seconds < 60) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
}
