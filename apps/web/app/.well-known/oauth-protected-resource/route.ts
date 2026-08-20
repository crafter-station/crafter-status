import {
	metadataCorsOptionsRequestHandler,
	protectedResourceHandlerClerk,
} from "@clerk/mcp-tools/next";

/**
 * RFC 9728 protected-resource metadata. This is how an MCP client discovers that
 * Clerk is our authorization server and self-registers against it, which is what
 * makes the "no token, just sign in with GitHub" flow work.
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
