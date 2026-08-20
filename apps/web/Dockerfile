# Bun installs (it owns bun.lock and the workspace links), Node builds and runs.
#
# `next build` under Bun dies collecting page data — Bun's CommonJS loader cannot
# load Next's precompiled server runtime ("Expected CommonJS module to have a
# function wrapper"). Node has no such problem, and node_modules is just files, so
# the two runtimes hand off cleanly.

FROM oven/bun:1.2-debian AS deps
WORKDIR /app

# Every workspace manifest, not just this app's: bun.lock describes the whole
# workspace, and --frozen-lockfile fails if any of them is missing.
COPY package.json bun.lock tsconfig.base.json ./
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
COPY apps/ingestor/package.json apps/ingestor/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
# Puppeteer is a transitive dependency of the ingestor and pulls ~150MB of
# Chromium that this image never runs.
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN bun install --frozen-lockfile


FROM node:22-bookworm-slim AS builder
WORKDIR /app

# node_modules plus the manifests and workspace symlinks bun created.
COPY --from=deps /app ./
COPY packages ./packages
COPY apps/web ./apps/web

# NEXT_PUBLIC_* values are inlined at build time, so they must be present here.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
	NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

WORKDIR /app/apps/web
RUN node /app/node_modules/next/dist/bin/next build


FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
	HOSTNAME=0.0.0.0 \
	PORT=3000

COPY --from=builder /app ./

WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node", "/app/node_modules/next/dist/bin/next", "start"]
