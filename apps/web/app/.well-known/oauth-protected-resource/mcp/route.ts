import {
	metadataCorsOptionsRequestHandler,
	protectedResourceHandlerClerk,
} from "@clerk/mcp-tools/next";

/**
 * Same metadata, served at the resource-specific path some clients probe
 * (`/.well-known/oauth-protected-resource{/resource-path}`) rather than the root one.
 */
const handler = protectedResourceHandlerClerk({
	scopes_supported: ["profile", "email"],
});
const corsHandler = metadataCorsOptionsRequestHandler();

export { corsHandler as OPTIONS, handler as GET };
