import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Public surface. `/mcp` and the OAuth metadata endpoints authenticate themselves
 * (bearer token or Clerk OAuth), so they must not be caught by the session gate —
 * an MCP client has no browser session to redirect.
 */
const isPublic = createRouteMatcher([
	"/sign-in(.*)",
	"/not-authorized",
	"/mcp(.*)",
	"/.well-known/(.*)",
	"/api/webhooks/(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
	if (isPublic(req)) return;
	await auth.protect();
});

export const config = {
	matcher: [
		// Everything except Next internals and static files, plus all API routes.
		"/((?!_next|[^?]*.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
		"/(api|trpc)(.*)",
	],
};
