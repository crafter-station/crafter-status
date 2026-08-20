export type Config = {
	/** Origin of the Crafter Status deployment, e.g. https://wspstatus.crafter.run */
	apiUrl: string;
	/** Personal token minted in the dashboard (crft_…). */
	token: string;
};

export type GlobalFlags = {
	json: boolean;
	output: "auto" | "json" | "table";
	quiet: boolean;
	verbose: boolean;
	yes: boolean;
};

export type OutputMode = "json" | "human";
