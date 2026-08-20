import {
	metadataCorsOptionsRequestHandler,
	protectedResourceHandlerClerk,
} from "@clerk/mcp-tools/next";

/**
 * Same metadata, served at the resource-specific path some clients probe
 * (`/.well-known/oauth-protected-resource{/resource-path}`) rather than the root one.
 */
// `resource` is set explicitly rather than inferred: behind Traefik the helper
// derives the origin from the container's own host and advertises
// https://localhost:3000, which no MCP client will accept.
const handler = protectedResourceHandlerClerk({
	scopes_supported: ["profile", "email"],
	resource: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
});
const corsHandler = metadataCorsOptionsRequestHandler();

export { corsHandler as OPTIONS, handler as GET };
