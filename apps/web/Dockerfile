FROM oven/bun:1.2-debian AS builder

WORKDIR /app

# Every workspace manifest, not just this app's: bun.lock describes the whole
# workspace, and --frozen-lockfile fails if any of them is missing.
COPY package.json bun.lock ./
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
COPY apps/ingestor/package.json apps/ingestor/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
# Puppeteer is a transitive dependency of the ingestor and pulls ~150MB of
# Chromium that this image never runs.
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN bun install --frozen-lockfile

COPY packages ./packages
COPY apps/web ./apps/web

# NEXT_PUBLIC_* values are inlined at build time, so they must be present here.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
	NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

RUN bun run --cwd apps/web build

FROM oven/bun:1.2-debian AS runner
WORKDIR /app
ENV NODE_ENV=production \
	HOSTNAME=0.0.0.0 \
	PORT=3000

COPY --from=builder /app ./

EXPOSE 3000
CMD ["bun", "run", "--cwd", "apps/web", "start"]
