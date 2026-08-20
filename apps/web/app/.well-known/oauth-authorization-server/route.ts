import {
	authServerMetadataHandlerClerk,
	metadataCorsOptionsRequestHandler,
} from "@clerk/mcp-tools/next";

/** RFC 8414 metadata, proxied from the Clerk instance backing this app. */
const handler = authServerMetadataHandlerClerk();
const corsHandler = metadataCorsOptionsRequestHandler();

export { corsHandler as OPTIONS, handler as GET };
