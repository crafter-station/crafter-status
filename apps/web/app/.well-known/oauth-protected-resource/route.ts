import {
	metadataCorsOptionsRequestHandler,
	protectedResourceHandlerClerk,
} from "@clerk/mcp-tools/next";

/**
 * RFC 9728 protected-resource metadata. This is how an MCP client discovers that
 * Clerk is our authorization server and self-registers against it, which is what
 * makes the "no token, just sign in with GitHub" flow work.
 */
const handler = protectedResourceHandlerClerk({
	scopes_supported: ["profile", "email"],
});
const corsHandler = metadataCorsOptionsRequestHandler();

export { corsHandler as OPTIONS, handler as GET };
