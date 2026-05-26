export type Config = {
	openaiApiKey: string;
	model: string;
};

export type GlobalFlags = {
	json: boolean;
	output: "auto" | "json" | "table";
	quiet: boolean;
	verbose: boolean;
	yes: boolean;
};

export type OutputMode = "json" | "human";

export type GroupSummary = {
	id: string;
	name: string;
	participantCount: number;
};

export type GroupMessage = {
	id: string;
	timestamp: number;
	from: string;
	author: string | null;
	body: string;
	type: string;
};

export type GroupTranscript = {
	group: GroupSummary;
	messages: GroupMessage[];
};
