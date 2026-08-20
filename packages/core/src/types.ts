/**
 * Pure domain types. This package deliberately has no dependency on the database
 * layer — `@crafter/db` imports these to type its JSONB columns, so the arrow
 * points core -> db and never back.
 */

export type ChannelRef = {
	id: string;
	name: string;
};

/** A message as the summarizer sees it. Deliberately narrower than the DB row. */
export type SummaryMessage = {
	id: string;
	timestamp: Date;
	authorName: string | null;
	body: string;
	type: string;
	hasMedia: boolean;
};

export type ActionItem = {
	/** What needs doing, in the language the group speaks. */
	text: string;
	/** Display name of the person on the hook, or null when nobody was named. */
	owner: string | null;
	/** Free-form due date as stated in the chat ("viernes", "next sprint"), or null. */
	due: string | null;
};

export type SummaryLink = {
	url: string;
	label: string;
};

/** The structured half of a daily summary. Stored as JSONB columns. */
export type SummaryContent = {
	tldr: string;
	decisions: string[];
	actionItems: ActionItem[];
	openQuestions: string[];
	links: SummaryLink[];
	participants: string[];
};

/** What the summarizer returns: structure plus a rendered markdown view. */
export type SummaryResult = SummaryContent & {
	markdown: string;
	model: string;
	messageCount: number;
	promptTokens: number;
	completionTokens: number;
};

export type SessionStatus = "disconnected" | "qr_pending" | "connecting" | "connected";

export type UserRole = "admin" | "member";
